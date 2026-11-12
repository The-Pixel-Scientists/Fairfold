// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate candidates (ADR 0025): suggestions for staff, never an action.
// Nothing here links, merges or flags anyone, and nothing is stored. The
// signals are verified or claimed identifier equality, trigram name
// similarity, and postcode; for people, the same email, or a similar name
// with a current link to the same organisation. Similarity is the
// schema-qualified `ext.similarity()` with the thresholds as parameters, and
// no setting is changed for the session. Row-level security keeps every
// candidate in the caller's tenant, and applies before the similarity test,
// which is not leakproof, so no index is used. Merged and erased parties are
// never candidates.

import type { Id } from '@pixel-scientists/domain';

import {
  duplicateThresholds,
  type DuplicateCandidate,
  type DuplicateSignal,
} from '../contracts/index.ts';
import type { PartyRequest } from './request.ts';
import { partyDb, type PartyDb } from './tables.ts';

/** The most candidates one request returns. */
const CAP = 20;

/** Strongest first: the order candidates are ranked in. */
const strength: readonly DuplicateSignal[] = [
  'verified_identifier',
  'email',
  'claimed_identifier',
  'name_and_postcode',
  'name_and_organisation',
  'name',
];

type Match = readonly [id: Id, signal: DuplicateSignal];

const NOT_GONE = ['merged', 'erased'] as const;

async function organisationMatches(db: PartyDb, id: string): Promise<Match[]> {
  const subject = await db
    .selectFrom('party.organisation')
    .select(['name', 'address_postcode'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const matches: Match[] = [];

  const identifiers = await db
    .selectFrom('party.organisation_identifier as a')
    .innerJoin('party.organisation_identifier as b', (join) =>
      join
        .onRef('b.scheme', '=', 'a.scheme')
        .onRef('b.identifier', '=', 'a.identifier')
        .onRef('b.organisation_id', '<>', 'a.organisation_id'),
    )
    .innerJoin('party.party as p', 'p.id', 'b.organisation_id')
    .select(['b.organisation_id as id', 'a.verified_by as mine', 'b.verified_by as theirs'])
    .where('a.organisation_id', '=', id)
    .where('p.status', 'not in', NOT_GONE)
    .execute();
  for (const { id: other, mine, theirs } of identifiers) {
    matches.push([
      other,
      mine !== null || theirs !== null ? 'verified_identifier' : 'claimed_identifier',
    ]);
  }

  // The lower threshold selects; the name signal then needs the higher one.
  const names = await db
    .selectFrom('party.organisation as o')
    .innerJoin('party.party as p', 'p.id', 'o.id')
    .select((eb) => [
      'o.id',
      'o.address_postcode',
      eb.fn<number>('ext.similarity', [eb.ref('o.name'), eb.val(subject.name)]).as('score'),
    ])
    .where('o.id', '<>', id)
    .where('p.status', 'not in', NOT_GONE)
    .where((eb) =>
      eb(
        eb.fn<number>('ext.similarity', [eb.ref('o.name'), eb.val(subject.name)]),
        '>=',
        duplicateThresholds.nameAndPostcode,
      ),
    )
    .execute();
  for (const { id: other, address_postcode, score } of names) {
    if (score >= duplicateThresholds.name) matches.push([other, 'name']);
    if (address_postcode === subject.address_postcode) matches.push([other, 'name_and_postcode']);
  }
  return matches;
}

async function personMatches(db: PartyDb, id: string): Promise<Match[]> {
  const subject = await db
    .selectFrom('party.person')
    .select(['given_name', 'family_name', 'email'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const matches: Match[] = [];

  const emails = await db
    .selectFrom('party.person as o')
    .innerJoin('party.party as p', 'p.id', 'o.id')
    .select('o.id')
    .where('o.id', '<>', id)
    .where('o.email', '=', subject.email)
    .where('p.status', 'not in', NOT_GONE)
    .execute();
  matches.push(...emails.map(({ id: other }): Match => [other, 'email']));

  const name = [subject.given_name, subject.family_name].filter(Boolean).join(' ');
  if (name === '') return matches;
  const colleagues = await db
    .selectFrom('party.relationship as mine')
    .innerJoin('party.relationship as theirs', (join) =>
      join
        .onRef('theirs.object_id', '=', 'mine.object_id')
        .onRef('theirs.subject_id', '<>', 'mine.subject_id'),
    )
    .innerJoin('party.person as o', 'o.id', 'theirs.subject_id')
    .innerJoin('party.party as p', 'p.id', 'o.id')
    .select('o.id')
    .distinct()
    .where('mine.subject_id', '=', id)
    .where('mine.ends_on', 'is', null)
    .where('theirs.ends_on', 'is', null)
    .where('p.status', 'not in', NOT_GONE)
    .where((eb) =>
      eb(
        eb.fn<number>('ext.similarity', [
          eb.fn<string>('concat_ws', [
            eb.val(' '),
            eb.ref('o.given_name'),
            eb.ref('o.family_name'),
          ]),
          eb.val(name),
        ]),
        '>=',
        duplicateThresholds.nameAndOrganisation,
      ),
    )
    .execute();
  matches.push(...colleagues.map(({ id: other }): Match => [other, 'name_and_organisation']));
  return matches;
}

/**
 * Candidates for one party, strongest first and capped. A party that is not
 * here, or is merged or erased, has none. A person's candidates are a
 * sensitive read, so they are audited. The caller has checked that the
 * session may manage party records.
 */
export async function duplicateCandidates(
  { tx, audit }: PartyRequest,
  partyId: Id,
): Promise<readonly DuplicateCandidate[]> {
  const db = partyDb(tx);
  const party = await db
    .selectFrom('party.party')
    .select(['kind', 'status'])
    .where('id', '=', partyId)
    .executeTakeFirst();
  if (party === undefined || party.status === 'merged' || party.status === 'erased') return [];

  if (party.kind === 'person') {
    await audit.read({ action: 'party.person.viewed', entityId: partyId });
  }
  const matches =
    party.kind === 'person'
      ? await personMatches(db, partyId)
      : await organisationMatches(db, partyId);

  const signals = new Map<Id, Set<DuplicateSignal>>();
  for (const [id, signal] of matches) signals.set(id, (signals.get(id) ?? new Set()).add(signal));
  const rank = (found: Iterable<DuplicateSignal>) =>
    Math.min(...[...found].map((signal) => strength.indexOf(signal)));
  return [...signals]
    .sort(([a, x], [b, y]) => rank(x) - rank(y) || a.localeCompare(b))
    .slice(0, CAP)
    .map(([id, found]) => ({
      partyId: id,
      signals: [...found].sort((x, y) => strength.indexOf(x) - strength.indexOf(y)),
    }));
}
