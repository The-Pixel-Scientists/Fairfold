// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What crm reads of party's records (ADR 0016, ADR 0017), over party's own
// tables in the caller's request transaction, so row-level security keeps
// every answer in the tenant. Nothing here writes. crm's `PartyReads` is this
// shape, and the platform passes this in; crm never queries a party table.

import {
  identifierSchemeIds,
  normaliseIdentifier,
  type PartyKind,
  type ValueHistoryField,
} from '../contracts/index.ts';
import type { Tx } from './tables.ts';

type Status = 'active' | 'archived' | 'merged' | 'erased';
type Verification = 'verified' | 'claimed' | 'none';

interface Facts {
  readonly id: string;
  readonly kind: PartyKind;
  readonly status: Status;
}

interface Query {
  readonly term: string;
  readonly kinds: readonly PartyKind[];
  readonly statuses: readonly Status[];
  readonly verification?: Verification | undefined;
  readonly among?: readonly string[] | undefined;
  readonly limit: number;
}

interface Scan {
  readonly kind?: PartyKind | undefined;
  readonly statuses?: readonly Status[] | undefined;
  readonly filters: readonly {
    readonly field:
      'kind' | 'status' | 'legal_form' | 'identifier_scheme' | 'contact_for' | 'created';
    readonly operator: string;
    readonly value: string;
  }[];
  readonly afterId?: string | undefined;
  readonly limit: number;
}

type Tables = {
  'party.party': {
    id: string;
    kind: 'organisation' | 'person';
    status: Status;
    merged_into: string | null;
    created_at: Date;
  };
  'party.organisation': {
    id: string;
    name: string;
    legal_form: string;
    address_line1: string;
    address_line2: string | null;
    address_town: string;
    address_postcode: string;
    address_country_code: string;
    website: string | null;
  };
  'party.organisation_identifier': {
    id: string;
    organisation_id: string;
    scheme: string;
    identifier: string;
    verified_by: string | null;
  };
  'party.person': {
    id: string;
    given_name: string | null;
    family_name: string | null;
    email: string;
    phone: string | null;
    user_id: string | null;
  };
  'party.relationship': {
    id: string;
    type: string;
    subject_id: string;
    object_id: string;
    ends_on: Date | null;
  };
};

const db = (tx: Tx) => tx.$extendTables<Tables>();

/** pg_trgm's own default for its `%` operator: how alike a name must be to count. */
const NAME_SIMILARITY = 0.3;

/** The day after a date, as text, so that "after" means a later day. */
const nextDay = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function findOrganisations(tx: Tx, q: Query) {
  const identifiers = [
    ...new Set(identifierSchemeIds.map((scheme) => normaliseIdentifier(scheme, q.term))),
  ];
  const rows = await db(tx)
    .selectFrom('party.organisation as o')
    .innerJoin('party.party as p', 'p.id', 'o.id')
    .select((eb) => [
      'o.id',
      'o.name',
      'p.status',
      'p.merged_into',
      eb.fn<number>('ext.similarity', [eb.ref('o.name'), eb.val(q.term)]).as('score'),
      eb
        .exists(
          eb
            .selectFrom('party.organisation_identifier as i')
            .select('i.id')
            .whereRef('i.organisation_id', '=', 'o.id'),
        )
        .as('claimed'),
      eb
        .exists(
          eb
            .selectFrom('party.organisation_identifier as i')
            .select('i.id')
            .whereRef('i.organisation_id', '=', 'o.id')
            .where('i.verified_by', 'is not', null),
        )
        .as('verified'),
    ])
    .where('p.status', 'in', q.statuses)
    .$if(q.among !== undefined, (qb) => qb.where('o.id', 'in', [...(q.among ?? [])]))
    .where((eb) =>
      eb.or([
        eb(
          eb.fn<number>('strpos', [
            eb.fn<string>('lower', [eb.ref('o.name')]),
            eb.fn<string>('lower', [eb.val(q.term)]),
          ]),
          '>',
          0,
        ),
        eb(
          eb.fn<number>('ext.similarity', [eb.ref('o.name'), eb.val(q.term)]),
          '>=',
          NAME_SIMILARITY,
        ),
        eb.exists(
          eb
            .selectFrom('party.organisation_identifier as i')
            .select('i.id')
            .whereRef('i.organisation_id', '=', 'o.id')
            .where('i.identifier', 'in', identifiers),
        ),
      ]),
    )
    .orderBy('score', 'desc')
    .orderBy('o.name')
    .orderBy('o.id')
    .limit(q.limit)
    .execute();
  return rows
    .map((row) => ({
      id: row.id,
      kind: 'organisation' as const,
      label: row.name,
      status: row.status,
      mergedInto: row.merged_into,
      verification: row.verified
        ? ('verified' as const)
        : row.claimed
          ? ('claimed' as const)
          : ('none' as const),
      score: row.score,
    }))
    .filter((row) => q.verification === undefined || row.verification === q.verification);
}

async function findPeople(tx: Tx, q: Query) {
  if (q.verification !== undefined && q.verification !== 'none') return [];
  const rows = await db(tx)
    .selectFrom('party.person as o')
    .innerJoin('party.party as p', 'p.id', 'o.id')
    .select((eb) => [
      'o.id',
      'o.given_name',
      'o.family_name',
      'o.email',
      'p.status',
      'p.merged_into',
      eb
        .fn<number>('ext.similarity', [
          eb.fn<string>('concat_ws', [
            eb.val(' '),
            eb.ref('o.given_name'),
            eb.ref('o.family_name'),
          ]),
          eb.val(q.term),
        ])
        .as('score'),
    ])
    .where('p.status', 'in', q.statuses)
    .$if(q.among !== undefined, (qb) => qb.where('o.id', 'in', [...(q.among ?? [])]))
    .where((eb) => {
      const name = eb.fn<string>('concat_ws', [
        eb.val(' '),
        eb.ref('o.given_name'),
        eb.ref('o.family_name'),
      ]);
      return eb.or([
        eb(
          eb.fn<number>('strpos', [
            eb.fn<string>('lower', [name]),
            eb.fn<string>('lower', [eb.val(q.term)]),
          ]),
          '>',
          0,
        ),
        eb(eb.fn<number>('ext.similarity', [name, eb.val(q.term)]), '>=', NAME_SIMILARITY),
        eb(
          eb.fn<number>('strpos', [
            eb.fn<string>('lower', [eb.ref('o.email')]),
            eb.fn<string>('lower', [eb.val(q.term)]),
          ]),
          '>',
          0,
        ),
      ]);
    })
    .orderBy('score', 'desc')
    .orderBy('o.family_name')
    .orderBy('o.id')
    .limit(q.limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    kind: 'person' as const,
    label: [row.given_name, row.family_name].filter(Boolean).join(' ') || row.email,
    status: row.status,
    mergedInto: row.merged_into,
    verification: 'none' as const,
    score: row.score,
  }));
}

export const partyReadsForCrm = {
  async facts(tx: Tx, ids: readonly string[]): Promise<readonly Facts[]> {
    if (ids.length === 0) return [];
    return db(tx)
      .selectFrom('party.party')
      .select(['id', 'kind', 'status'])
      .where('id', 'in', [...ids])
      .execute();
  },

  async search(tx: Tx, q: Query) {
    const found = [
      ...(q.kinds.includes('organisation') ? await findOrganisations(tx, q) : []),
      ...(q.kinds.includes('person') ? await findPeople(tx, q) : []),
    ];
    return found.sort((a, b) => b.score - a.score).slice(0, q.limit);
  },

  async values(tx: Tx, kind: PartyKind, id: string) {
    const values = new Map<ValueHistoryField, string | null>();
    if (kind === 'organisation') {
      const row = await db(tx)
        .selectFrom('party.organisation')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      const identifiers = await db(tx)
        .selectFrom('party.organisation_identifier')
        .select(['scheme', 'identifier'])
        .where('organisation_id', '=', id)
        .execute();
      values
        .set('organisation.name', row?.name ?? null)
        .set('organisation.legal_form', row?.legal_form ?? null)
        .set('organisation.address_line1', row?.address_line1 ?? null)
        .set('organisation.address_line2', row?.address_line2 ?? null)
        .set('organisation.address_town', row?.address_town ?? null)
        .set('organisation.address_postcode', row?.address_postcode ?? null)
        .set('organisation.address_country_code', row?.address_country_code ?? null)
        .set('organisation.website', row?.website ?? null)
        .set(
          'organisation.identifier',
          identifiers
            .map((i) => `${i.scheme} ${i.identifier}`)
            .sort()
            .join(', ') || null,
        );
    } else {
      const row = await db(tx)
        .selectFrom('party.person')
        .select(['given_name', 'family_name', 'email', 'phone'])
        .where('id', '=', id)
        .executeTakeFirst();
      values
        .set('person.given_name', row?.given_name ?? null)
        .set('person.family_name', row?.family_name ?? null)
        .set('person.email', row?.email ?? null)
        .set('person.phone', row?.phone ?? null);
    }
    return values;
  },

  async carriedLinks(tx: Tx, loserId: string, survivorId: string) {
    const accounts = await db(tx)
      .selectFrom('party.person')
      .select('user_id')
      .where('id', 'in', [loserId, survivorId])
      .execute();
    if (!accounts.every((person) => person.user_id === null)) return null;
    const current = await db(tx)
      .selectFrom('party.relationship')
      .select(['id', 'object_id'])
      .where('subject_id', '=', loserId)
      .where('type', '=', 'contact_for')
      .where('ends_on', 'is', null)
      .orderBy('id')
      .execute();
    return current.map((link) => ({ relationshipId: link.id, organisationId: link.object_id }));
  },

  async scan(tx: Tx, { kind, statuses, filters, afterId, limit }: Scan) {
    return db(tx)
      .selectFrom('party.party as p')
      .select(['p.id', 'p.kind'])
      .$if(kind !== undefined, (qb) => qb.where('p.kind', '=', kind as 'person'))
      .$if(statuses !== undefined, (qb) => qb.where('p.status', 'in', [...(statuses ?? [])]))
      .$if(afterId !== undefined, (qb) => qb.where('p.id', '>', afterId as string))
      .where((eb) => {
        const identifier = (value: string) =>
          eb
            .selectFrom('party.organisation_identifier as n')
            .select('n.id')
            .whereRef('n.organisation_id', '=', 'p.id')
            .where('n.scheme', '=', value);
        return eb.and(
          filters.map((filter) => {
            const { field, operator, value } = filter;
            switch (field) {
              case 'kind':
                return eb('p.kind', '=', value as 'organisation' | 'person');
              case 'status':
                return eb('p.status', operator === 'eq' ? '=' : '<>', value as 'active');
              case 'legal_form':
                return eb.exists(
                  eb
                    .selectFrom('party.organisation as o')
                    .select('o.id')
                    .whereRef('o.id', '=', 'p.id')
                    .where('o.legal_form', operator === 'eq' ? '=' : '<>', value),
                );
              case 'identifier_scheme':
                return operator === 'lacks'
                  ? eb.not(eb.exists(identifier(value)))
                  : eb.exists(
                      operator === 'has_verified'
                        ? identifier(value).where('n.verified_by', 'is not', null)
                        : identifier(value),
                    );
              case 'contact_for':
                return eb.exists(
                  eb
                    .selectFrom('party.relationship as r')
                    .select('r.id')
                    .whereRef('r.subject_id', '=', 'p.id')
                    .where('r.object_id', '=', value)
                    .where('r.type', '=', 'contact_for')
                    .where('r.ends_on', 'is', null),
                );
              case 'created':
                return operator === 'before'
                  ? eb('p.created_at', '<', eb.cast<Date>(eb.val(value), 'timestamptz'))
                  : eb('p.created_at', '>=', eb.cast<Date>(eb.val(nextDay(value)), 'timestamptz'));
            }
          }),
        );
      })
      .orderBy('p.id')
      .limit(limit)
      .execute();
  },
};
