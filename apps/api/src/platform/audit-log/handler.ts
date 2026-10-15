// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tenant's audit log for its administrators (architecture rule 4,
// ADR 0003). Events come back as stored, newest first: field ids, with
// values only where the writer kept them (D12). The names added here are
// staff members' only, from the party module, so the log holds no applicant's
// personal details and reading it is not itself audited.

import type {
  AuditEvent,
  AuditEventPage,
  listAuditEvents,
} from '@pixel-scientists/domain/platform/audit-log';
import { roles } from '@pixel-scientists/domain/platform';
import { peopleByUserIds } from '@pixel-scientists/party/server';

import type { Handler } from '../../routes/register.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

/** Events on a page. The contract has no page size, so this is the most a caller gets. */
export const PAGE_SIZE = 100;

type AuditTables = {
  'app.audit_event': {
    tenant_id: string;
    id: string;
    occurred_at: Date;
    actor_kind: 'user' | 'system' | 'operator';
    actor_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    changes: AuditEvent['changes'];
  };
  'app.membership': { id: string; user_id: string; roles: string[] };
  'app.tenant': { timezone: string };
};

const isRole = (name: string): name is keyof typeof roles => Object.hasOwn(roles, name);

/** Staff hold a console role and no portal role; every other member is an applicant. */
function isStaff(memberRoles: readonly string[]): boolean {
  const apps = memberRoles.filter(isRole).map((name) => roles[name].app);
  return apps.includes('console') && !apps.includes('portal');
}

/** The day after a `YYYY-MM-DD` date. */
const nextDay = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export const listAuditEventsHandler: Handler<typeof listAuditEvents> = async ({ tx, input }) => {
  const { query } = input;
  const db = tx.$extendTables<AuditTables>();

  const events = db
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
    .select((eb) =>
      eb
        .fn<string>('to_char', [
          eb.fn('timezone', [eb.val('UTC'), 'occurred_at']),
          eb.val('YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        ])
        .as('cursor_at'),
    )
    .where((eb) => {
      // Days run in the tenant's time zone; row-level security leaves its one row.
      const zone = eb.selectFrom('app.tenant').select('timezone');
      const startOf = (date: string) =>
        eb.fn<Date>('timezone', [zone, eb.cast(eb.cast(eb.val(date), 'date'), 'timestamp')]);
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      return eb.and([
        eb('tenant_id', '=', eb.fn<string>('app.current_tenant_id', [])),
        ...(query.module === undefined
          ? []
          : [
              eb(
                eb.fn('split_part', [eb.ref('entity_type'), eb.val('.'), eb.lit(1)]),
                '=',
                query.module,
              ),
            ]),
        ...(query.action === undefined ? [] : [eb('action', '=', query.action)]),
        ...(query.entityType === undefined ? [] : [eb('entity_type', '=', query.entityType)]),
        ...(query.entityId === undefined ? [] : [eb('entity_id', '=', query.entityId)]),
        ...(query.byMembershipId === undefined ? [] : [eb('actor_id', '=', query.byMembershipId)]),
        ...(query.from === undefined ? [] : [eb('occurred_at', '>=', startOf(query.from))]),
        ...(query.to === undefined ? [] : [eb('occurred_at', '<', startOf(nextDay(query.to)))]),
        ...(after === undefined
          ? []
          : [
              eb(
                eb.refTuple('occurred_at', 'id'),
                '<',
                eb.tuple(
                  eb.cast<Date>(eb.val(after.occurredAt), 'timestamptz'),
                  eb.cast<string>(eb.val(after.id), 'uuid'),
                ),
              ),
            ]),
      ]);
    });

  const found = await events
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .limit(PAGE_SIZE + 1)
    .execute();
  const rows = found.slice(0, PAGE_SIZE);
  const last = rows.at(-1);
  const more = found.length > PAGE_SIZE && last !== undefined;

  const actorIds = [
    ...new Set(rows.flatMap((row) => (row.actor_id === null ? [] : [row.actor_id]))),
  ];
  const members =
    actorIds.length === 0
      ? []
      : await db
          .selectFrom('app.membership')
          .select(['id', 'user_id', 'roles'])
          .where('id', 'in', actorIds)
          .execute();
  const byMembership = new Map(members.map((member) => [member.id, member]));
  const people = await peopleByUserIds(
    tx,
    members.filter((member) => isStaff(member.roles)).map((member) => member.user_id),
  );

  const actor = (row: (typeof rows)[number]): AuditEvent['actor'] => {
    if (row.actor_kind === 'system' || row.actor_kind === 'operator') {
      return { kind: row.actor_kind };
    }
    if (row.actor_id === null) throw new Error('A user event has no acting membership.');
    const member = byMembership.get(row.actor_id);
    if (member === undefined || !isStaff(member.roles)) {
      return { kind: 'applicant', membershipId: row.actor_id };
    }
    const person = people.get(member.user_id);
    const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
    return { kind: 'staff', membershipId: row.actor_id, name: name === '' ? null : name };
  };

  const page: AuditEventPage = {
    events: rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actor: actor(row),
      changes: row.changes,
    })),
    nextCursor: more ? encodeCursor({ occurredAt: last.cursor_at, id: last.id }) : null,
  };
  return page;
};
