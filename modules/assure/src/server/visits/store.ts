// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where monitoring visits are kept (migration 0057): the visit, its attendees
// and its evidence. A visit's date is read and compared as text. Findings and
// follow-ups are personal, so only the handlers that audit a read of them call
// `readVisit`.

import type { Visit } from '../../contracts/index.ts';
import { assureDb, iso, type AssureDb, type Tx } from '../checklists/context.ts';

type FollowUps = Visit['followUps'];

/** A page's size: one more is read, to know whether there is a next page. */
export const PAGE_SIZE = 50;

const summary = (db: AssureDb) =>
  db
    .selectFrom('assure.monitoring_visit as v')
    .select((eb) => [
      'v.id',
      'v.organisation_id',
      'v.application_id',
      eb.cast<string>('v.visited_on', 'text').as('visited_on'),
      'v.visit_type',
      'v.follow_ups',
    ]);

/** A page of visits, newest first, after the cursor's date and id, with a count of follow-ups still open. */
export async function visitPage(
  tx: Tx,
  filter: { organisationId?: string | undefined; applicationId?: string | undefined },
  after: { readonly visitedOn: string; readonly id: string } | null,
) {
  let select = summary(assureDb(tx))
    .orderBy('v.visited_on', 'desc')
    .orderBy('v.id', 'desc')
    .limit(PAGE_SIZE + 1);
  if (filter.organisationId !== undefined) {
    select = select.where('v.organisation_id', '=', filter.organisationId);
  }
  if (filter.applicationId !== undefined) {
    select = select.where('v.application_id', '=', filter.applicationId);
  }
  if (after !== null) {
    const { visitedOn, id } = after;
    select = select.where((eb) => {
      const date = eb.cast<string>(eb.val(visitedOn), 'date');
      return eb.or([
        eb('v.visited_on', '<', date),
        eb.and([eb('v.visited_on', '=', date), eb('v.id', '<', id)]),
      ]);
    });
  }
  const rows = await select.execute();
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    visits: page.map((row) => ({
      id: row.id,
      organisationId: row.organisation_id,
      applicationId: row.application_id,
      visitedOn: row.visited_on,
      type: row.visit_type as Visit['type'],
      openFollowUps: (row.follow_ups as FollowUps).filter(({ done }) => !done).length,
    })),
    next:
      rows.length > PAGE_SIZE && last !== undefined
        ? { visitedOn: last.visited_on, id: last.id }
        : null,
  };
}

/** A visit with its attendees and evidence, or null when this tenant has none. */
export async function readVisit(tx: Tx, visitId: string): Promise<Visit | null> {
  const db = assureDb(tx);
  const row = await db
    .selectFrom('assure.monitoring_visit as v')
    .select((eb) => [
      'v.id',
      'v.organisation_id',
      'v.application_id',
      eb.cast<string>('v.visited_on', 'text').as('visited_on'),
      'v.visit_type',
      'v.findings',
      'v.follow_ups',
      'v.created_at',
      'v.updated_at',
    ])
    .where('v.id', '=', visitId)
    .executeTakeFirst();
  if (row === undefined) return null;
  const attendees = await db
    .selectFrom('assure.visit_attendee')
    .select('person_id')
    .where('visit_id', '=', visitId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const evidence = await db
    .selectFrom('assure.visit_evidence')
    .select(['file_id', 'caption'])
    .where('visit_id', '=', visitId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return {
    id: row.id,
    organisationId: row.organisation_id,
    applicationId: row.application_id,
    visitedOn: row.visited_on,
    type: row.visit_type as Visit['type'],
    attendeePersonIds: attendees.map(({ person_id: id }) => id),
    findings: row.findings,
    followUps: row.follow_ups as FollowUps,
    evidence: evidence.map(({ file_id: fileId, caption }) => ({ fileId, caption })),
    recordedAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** A visit's organisation, locked for a change; null when this tenant has no such visit. */
export async function lockVisit(tx: Tx, visitId: string): Promise<string | null> {
  const row = await assureDb(tx)
    .selectFrom('assure.monitoring_visit')
    .select('organisation_id')
    .where('id', '=', visitId)
    .forUpdate()
    .executeTakeFirst();
  return row?.organisation_id ?? null;
}
