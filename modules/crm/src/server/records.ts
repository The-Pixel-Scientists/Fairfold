// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Organisation and person detail (ADR 0017, ADR 0025): the record itself is
// party's, read through party's own handlers, and crm adds the lists it is
// on, its external references and a summary of its timeline. An id another
// tenant owns reads as a missing one, and so does an id of the other kind.
// A merged id answers its survivor's id, and an erased person only that. Every
// read writes `crm.party.viewed` with the party as the subject, since an
// organisation's record holds its contacts' names and email addresses.

import type { PartyKind } from '@pixel-scientists/party/contracts';
import { partyHandlers } from '@pixel-scientists/party/server';

import type { ExternalReference, OrganisationRecord, PersonRecord } from '../contracts/index.ts';
import {
  crmDb,
  iso,
  partyRequest,
  type Args,
  type CrmContext,
  type CrmDependencies,
  type Tx,
} from './context.ts';

type Parts = Pick<
  Extract<OrganisationRecord, { state: 'current' }>,
  'lists' | 'externalReferences' | 'timeline'
>;

async function crmParts(tx: Tx, partyId: string): Promise<Parts> {
  const db = crmDb(tx);
  const lists = await db
    .selectFrom('crm.list_member as m')
    .innerJoin('crm.list as l', 'l.id', 'm.list_id')
    .select(['l.id', 'l.name'])
    .where('m.party_id', '=', partyId)
    .where('l.archived_at', 'is', null)
    .orderBy('l.name')
    .orderBy('l.id')
    .execute();
  const references = await db
    .selectFrom('crm.external_reference')
    .select(['id', 'system', 'external_id', 'url', 'created_at'])
    .where('party_id', '=', partyId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const timeline = await db
    .selectFrom('crm.interaction')
    .select((eb) => [
      eb.fn.countAll<string>().as('interactions'),
      eb.fn.max<Date | null>('occurred_at').as('latest'),
    ])
    .where('party_id', '=', partyId)
    .executeTakeFirstOrThrow();
  return {
    lists,
    externalReferences: references.map((row) => ({
      id: row.id,
      system: row.system as ExternalReference['system'],
      externalId: row.external_id,
      url: row.url,
      addedAt: iso(row.created_at),
    })),
    timeline: {
      interactions: Number(timeline.interactions),
      latestAt: timeline.latest === null ? null : iso(timeline.latest),
    },
  };
}

export function recordHandlers(deps: CrmDependencies) {
  const party = partyHandlers({ notFound: deps.notFound });

  /** The party's state in this tenant, after the view is audited; missing, or of the other kind, is not found. */
  async function open(tx: Tx, context: CrmContext, id: string, kind: PartyKind) {
    const [row] = await deps.parties.facts(tx, [id]);
    if (row === undefined || row.kind !== kind) throw deps.notFound();
    await context.audit.read({ action: 'crm.party.viewed', entityId: id, subjectPartyId: id });
    if (row.status !== 'merged') return { status: row.status } as const;
    const survivor = await deps.merges.resolveParty(partyRequest(tx, context), id);
    return { status: 'merged', survivorId: survivor?.id ?? id } as const;
  }

  async function getOrganisationRecord({
    tx,
    context,
    input,
  }: Args<{ params: { organisationId: string } }>): Promise<OrganisationRecord> {
    const { organisationId } = input.params;
    const opened = await open(tx, context, organisationId, 'organisation');
    if (opened.status === 'merged') return { state: 'merged', survivorId: opened.survivorId };
    if (opened.status === 'erased') throw deps.notFound();
    return {
      state: 'current',
      status: opened.status,
      organisation: await party.getOrganisation({ tx, context, input }),
      ...(await crmParts(tx, organisationId)),
    };
  }

  async function getPersonRecord({
    tx,
    context,
    input,
  }: Args<{ params: { personId: string } }>): Promise<PersonRecord> {
    const { personId } = input.params;
    const opened = await open(tx, context, personId, 'person');
    if (opened.status === 'merged') return { state: 'merged', survivorId: opened.survivorId };
    if (opened.status === 'erased') return { state: 'erased' };
    return {
      state: 'current',
      status: opened.status,
      person: await party.getPerson({ tx, context, input }),
      ...(await crmParts(tx, personId)),
    };
  }

  return { getOrganisationRecord, getPersonRecord };
}
