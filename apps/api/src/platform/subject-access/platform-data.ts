// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The platform's own rows about a person (ADR 0027), each reached by its
// subject path in the classification map: the memberships of the person's
// account, the files, invitations and job requests those memberships made or
// accepted, and the audit events about the person or by their memberships.
// Every classified column is returned with its sensitivity, but for the
// columns, audit events and audit fields withheld below. Audit events hold
// ids, codes and field ids only, and name their actor by kind alone.

import type { Transaction } from '@pixel-scientists/db';
import { classification, subjectPaths } from '@pixel-scientists/db/classification';
import {
  subjectAuditEventSchema,
  subjectDataSchema,
  type SubjectData,
  type SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';
import type { z } from 'zod';

import { isStaff } from '../audit-log/handler.ts';

type Tables = Record<string, Record<string, unknown>>;

export type SubjectAuditEvent = z.infer<typeof subjectAuditEventSchema>;

const MEMBERSHIP = 'app.membership';
/** The membership column that holds the account's id (the table's `account` subject path). */
export const ACCOUNT_COLUMN = 'user_id';

/** Subject-path tables the platform leaves out of its tables, and why. */
export const excludedTables: Readonly<Record<string, string>> = {
  'app.audit_event': 'Read as the export audit events, which name each actor by kind only.',
  'app.idempotency_key': 'A one-way digest of a request, which names no one.',
  'app.message':
    'A message belongs to an application, so the grants module reads it through the application.',
  'app.note':
    'A note is about an applicant, not its author, so a staff member does not receive it. The grants module reads it through the application.',
  'app.request_limit': 'A hashed client key with no account or tenant.',
  'app.subject_key': 'Wrapped key material: a secret, not data about the person.',
};

/** The platform tables read through a membership, each with its column, from the subject paths. */
export const membershipTables: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(subjectPaths).flatMap(([table, path]) =>
    path.kind === 'join' && path.table === MEMBERSHIP && !Object.hasOwn(excludedTables, table)
      ? [[table, path.column]]
      : [],
  ),
);

/** Columns no export carries, each with why. */
export const withheldColumns: Readonly<Record<string, string>> = {
  'app.invitation.token_hash': 'A credential digest, not data about the person.',
  'app.job_request.filters':
    'It can name another person: the party a subject access request was made for.',
};

/**
 * Audit events left out until a check before release exists (rule 8:
 * decisions are private until released), each with why. Their changes hold an
 * unreleased outcome, a reviewer's id or the stage an application has reached.
 */
export const withheldAuditActions: Readonly<Record<string, string>> = {
  'grants.decision.recorded': 'It holds an outcome and amount that have not been released.',
  'grants.decision.changed': 'It holds an outcome and amount that have not been released.',
  'grants.assignment.created': 'It names the reviewer.',
  'grants.assignment.removed': 'It names the reviewer.',
  'grants.assignment.conflict_declared': 'It shows how a review has gone.',
  'grants.review.submitted': 'It shows how a review has gone.',
  'grants.reviewer.added': 'It names the reviewer.',
  'grants.reviewer.removed': 'It names the reviewer.',
  'grants.application.stage_changed': 'It shows how far the application has moved.',
};

/** Fields dropped from the changes of the audit events that are kept, each with why. */
export const withheldAuditFields: Readonly<Record<string, string>> = {
  'grants.application.stage_id': 'It shows how far the application has moved.',
  'grants.assignment.reviewer_membership_id': 'It names the reviewer.',
  'grants.reviewer.membership_id': 'It names the reviewer.',
};

function withoutWithheldFields(changes: unknown): unknown {
  if (typeof changes !== 'object' || changes === null) return changes;
  return Object.fromEntries(
    Object.entries(changes).filter(([field]) => !Object.hasOwn(withheldAuditFields, field)),
  );
}

/** The cell for a stored value: a timestamp is its ISO text and a byte string its hex. */
function cellValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  return value ?? null;
}

async function readRows(
  tx: Transaction<unknown>,
  table: string,
  column: string,
  values: readonly string[],
): Promise<SubjectDataRow[]> {
  if (values.length === 0) return [];
  const fields = Object.entries(classification[table] ?? {}).filter(
    ([name]) => !Object.hasOwn(withheldColumns, `${table}.${name}`),
  );
  const rows = await tx
    .$extendTables<Tables>()
    .selectFrom(table)
    .select(fields.map(([name]) => name))
    .where(column, 'in', values)
    .orderBy('id')
    .execute();
  return rows.map((row) =>
    Object.fromEntries(
      fields.map(([name, { sensitivity }]) => [
        `${table}.${name}`,
        { value: cellValue(row[name]), sensitivity },
      ]),
    ),
  ) as SubjectDataRow[];
}

/**
 * The memberships of the accounts `userIds` and the platform rows made
 * through them, with the memberships' ids for the audit query.
 */
export async function platformData(
  tx: Transaction<unknown>,
  userIds: readonly string[],
): Promise<{ data: SubjectData; membershipIds: string[] }> {
  const memberships = await readRows(tx, MEMBERSHIP, ACCOUNT_COLUMN, userIds);
  const membershipIds = memberships.flatMap((row) => {
    const id = row[`${MEMBERSHIP}.id`]?.value;
    return typeof id === 'string' ? [id] : [];
  });
  const data: SubjectData = { [MEMBERSHIP]: memberships };
  for (const [table, column] of Object.entries(membershipTables)) {
    data[table] = await readRows(tx, table, column, membershipIds);
  }
  return { data: subjectDataSchema.parse(data), membershipIds };
}

/**
 * The tenant's audit events about any of `subjectPartyIds` (a merge set, whose
 * events keep the ids they were written with) or done by any of
 * `membershipIds`, oldest first.
 */
export async function subjectAuditEvents(
  tx: Transaction<unknown>,
  subjectPartyIds: readonly string[],
  membershipIds: readonly string[],
): Promise<SubjectAuditEvent[]> {
  const db = tx.$extendTables<{
    'app.audit_event': {
      id: string;
      occurred_at: Date;
      actor_kind: 'user' | 'system' | 'operator';
      actor_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string;
      changes: unknown;
      subject_party_id: string | null;
    };
    'app.membership': { id: string; roles: string[] };
  }>();
  const events = await db
    .selectFrom('app.audit_event')
    .select([
      'id',
      'occurred_at',
      'actor_kind',
      'actor_id',
      'action',
      'entity_type',
      'entity_id',
      'changes',
    ])
    .where((eb) =>
      eb.or([
        eb('subject_party_id', 'in', subjectPartyIds),
        ...(membershipIds.length === 0 ? [] : [eb('actor_id', 'in', membershipIds)]),
      ]),
    )
    .where('action', 'not in', Object.keys(withheldAuditActions))
    .orderBy('occurred_at')
    .orderBy('id')
    .execute();
  const actorIds = [
    ...new Set(events.flatMap(({ actor_id }) => (actor_id === null ? [] : [actor_id]))),
  ];
  const members =
    actorIds.length === 0
      ? []
      : await db
          .selectFrom('app.membership')
          .select(['id', 'roles'])
          .where('id', 'in', actorIds)
          .execute();
  const staff = new Set(members.filter(({ roles }) => isStaff(roles)).map(({ id }) => id));
  return events.map((event) =>
    subjectAuditEventSchema.parse({
      id: event.id,
      occurredAt: event.occurred_at.toISOString(),
      action: event.action,
      entityType: event.entity_type,
      entityId: event.entity_id,
      actor: {
        kind:
          event.actor_kind === 'user'
            ? staff.has(event.actor_id ?? '')
              ? 'staff'
              : 'applicant'
            : event.actor_kind,
      },
      changes: withoutWithheldFields(event.changes),
    }),
  );
}
