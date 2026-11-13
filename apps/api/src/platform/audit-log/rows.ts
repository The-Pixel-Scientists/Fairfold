// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log as the rows of an export file (E3, ADR 0009): the events
// that match the filters, newest first, read a page at a time and handed on
// one row at a time, so no step holds the log in memory. Past the row limit
// the export fails with a code, never a file that stops part way. The
// changes are written as stored: field ids, with values only where the writer
// kept them. The only personal data here is a staff member's name, which
// is why the file is classed personal.

import { JobError } from '@pixel-scientists/db/jobs';
import { auditActionLabel } from '@pixel-scientists/domain/platform/audit-log';
import type {
  AuditSearch,
  AuditSearchEvent,
  AuditSearchPage,
} from '@pixel-scientists/domain/platform/audit-log';

import type { CsvRow } from '../csv/index.ts';

/** The most events one export holds. */
export const AUDIT_EXPORT_ROW_LIMIT = 500_000;

/** The columns an export reads: each is in the classification map, and the name is a person's. */
export const AUDIT_EXPORT_FIELD_IDS = [
  'app.audit_event.occurred_at',
  'app.audit_event.actor_kind',
  'app.audit_event.actor_id',
  'app.audit_event.action',
  'app.audit_event.entity_type',
  'app.audit_event.entity_id',
  'app.audit_event.subject_party_id',
  'app.audit_event.changes',
  'party.person.given_name',
  'party.person.family_name',
] as const;

export const AUDIT_EXPORT_HEADING: CsvRow = [
  'Time (tenant time zone)',
  'Time (UTC)',
  'Actor',
  'Actor membership id',
  'Action',
  'Action code',
  'Module',
  'Entity type',
  'Entity id',
  'Subject party id',
  'Changes',
];

/** `2026-03-29 01:30:00` in the zone. */
export function localTime(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map(({ type, value }) => [type, value]),
  ) as Record<string, string>;
  return `${parts['year']}-${parts['month']}-${parts['day']} ${parts['hour']}:${parts['minute']}:${parts['second']}`;
}

const ACTORS = { applicant: 'Applicant', system: 'System', operator: 'Operator' } as const;

function actorCells(actor: AuditSearchEvent['actor']): readonly [string, string | null] {
  if (actor.kind === 'staff') return [actor.name ?? 'Team member', actor.membershipId];
  if (actor.kind === 'applicant') return [ACTORS.applicant, actor.membershipId];
  return [ACTORS[actor.kind], null];
}

export function auditExportRow(event: AuditSearchEvent, timeZone: string): CsvRow {
  const [actor, membershipId] = actorCells(event.actor);
  return [
    localTime(new Date(event.occurredAt), timeZone),
    event.occurredAt,
    actor,
    membershipId,
    auditActionLabel(event.action),
    event.action,
    event.entityType.split('.')[0],
    event.entityType,
    event.entityId,
    event.subjectPartyId,
    JSON.stringify(event.changes),
  ];
}

export async function* auditExportRows(
  readPage: (search: AuditSearch) => Promise<AuditSearchPage>,
  filters: Omit<AuditSearch, 'cursor'>,
  timeZone: string,
  limit = AUDIT_EXPORT_ROW_LIMIT,
): AsyncGenerator<CsvRow> {
  let cursor: string | undefined;
  let written = 0;
  do {
    const page = await readPage(cursor === undefined ? filters : { ...filters, cursor });
    for (const event of page.events) {
      written += 1;
      if (written > limit) throw new JobError('precondition_failed');
      yield auditExportRow(event, timeZone);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
}
