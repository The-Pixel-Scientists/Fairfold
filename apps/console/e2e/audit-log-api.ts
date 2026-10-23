// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the audit log specs: an administrator of a funder
// whose log holds a crowd of events, which lists them with the filters and
// pages of the real contract, newest first. Answers are plain JSON in the
// shape of the contract in packages/domain/src/platform/audit-log; the console
// checks each one against its contract, and so does this stand-in for what it
// takes.

import { auditEventQuerySchema } from '@pixel-scientists/domain/platform/audit-log';
import type { AuditEvent } from '@pixel-scientists/domain/platform/audit-log';
import type { Page } from '@playwright/test';

import { problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';

/** What the real API sends in a page. */
export const PAGE_SIZE = 100;

const TIME_ZONE = 'Europe/London';

export const ada = '5b1a8d3e-2c4f-4e7a-9b6d-1a2b3c4d5e6f';
const marcus = '7c2d9e4f-3a5b-4c8d-8e1f-2b3c4d5e6f70';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** In the order they cycle through the crowd. */
const kinds = [
  ['grants.application.stage_changed', 'grants.application', ada],
  ['platform.theme.changed', 'platform.theme', ada],
  ['grants.application.viewed', 'grants.application', marcus],
  ['grants.decision.released', 'grants.decision', marcus],
  ['platform.membership.roles_changed', 'platform.membership', ada],
] as const;

/** The nth event, the latest first: one every 40 minutes back from 3pm on 30 October 2026. */
function event(n: number): AuditEvent {
  const [action, entityType, by] = kinds[n % kinds.length] ?? kinds[0];
  return {
    id: uuid(n + 1),
    occurredAt: new Date(Date.UTC(2026, 9, 30, 15) - n * 40 * 60_000).toISOString(),
    action,
    entityType,
    entityId: uuid(9000 + n),
    actor: { kind: 'staff', membershipId: by, name: by === ada ? 'Ada Morgan' : 'Marcus Bell' },
    changes:
      n % 5 === 0
        ? {
            'grants.application.stage_id': {},
            'grants.application.status': { before: 'submitted', after: 'in_review' },
          }
        : {},
  };
}

/** Events, the latest first. Spec files may change them between steps. */
export const crowd = (count = 250): AuditEvent[] =>
  Array.from({ length: count }, (_, n) => event(n));

/** The day of a moment in the funder's time zone, as `YYYY-MM-DD`. */
const dayOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

const cursorOf = (index: number) => Buffer.from(String(index)).toString('base64url');
const indexOf = (cursor: string) => Number(Buffer.from(cursor, 'base64url').toString());

function list(held: readonly AuditEvent[], search: URLSearchParams): Reply {
  const parsed = auditEventQuerySchema.safeParse(Object.fromEntries(search));
  if (!parsed.success) return problem(400, 'This filter is not valid.');
  const { module, action, entityType, entityId, byMembershipId, from, to, cursor } = parsed.data;
  const matching = held.filter(
    (item) =>
      (module === undefined || item.entityType.startsWith(`${module}.`)) &&
      (action === undefined || item.action === action) &&
      (entityType === undefined || item.entityType === entityType) &&
      (entityId === undefined || item.entityId === entityId) &&
      (byMembershipId === undefined ||
        (item.actor.kind === 'staff' && item.actor.membershipId === byMembershipId)) &&
      (from === undefined || dayOf(item.occurredAt) >= from) &&
      (to === undefined || dayOf(item.occurredAt) <= to),
  );
  const start = cursor === undefined ? 0 : indexOf(cursor);
  const end = start + PAGE_SIZE;
  return {
    status: 200,
    body: {
      events: matching.slice(start, end),
      nextCursor: end < matching.length ? cursorOf(end) : null,
    },
  };
}

export interface AuditStub {
  /** What the funder's log holds. A spec may change it between steps. */
  held: AuditEvent[];
  sent: SentRequest[];
}

const ok = (body: unknown): Reply => ({ status: 200, body });

const administrator = [
  'platform.audit.read',
  'platform.settings.manage',
  'platform.members.manage',
];

/**
 * A signed-in administrator of a funder whose log holds `held`. `more`
 * replaces answers, keyed like `GET /console/team`, and `permissions`
 * replaces the administrator's.
 */
export async function stubAuditLog(
  page: Page,
  held: AuditEvent[] = crowd(),
  more: Record<string, Handler> = {},
  permissions: string[] = administrator,
): Promise<AuditStub> {
  const sent = await stubSignedIn(
    page,
    { permissions },
    {
      'GET /console/settings': ok({
        name: 'Northfield Foundation',
        timeZone: TIME_ZONE,
        fiscalYearStartMonth: 4,
      }),
      'GET /console/team': ok({
        members: [
          {
            id: ada,
            name: 'Ada Morgan',
            email: 'ada@example.org',
            roles: ['tenant_admin'],
            status: 'active',
          },
          {
            id: marcus,
            name: 'Marcus Bell',
            email: 'marcus@example.org',
            roles: ['programme_manager'],
            status: 'active',
          },
        ],
        invitations: [],
      }),
      ...more,
    },
  );

  await page.route(
    (url) => url.pathname === '/api/console/audit-events',
    async (route) => {
      const url = new URL(route.request().url());
      sent.push({ key: `GET /console/audit-events${url.search}`, body: undefined });
      const reply = list(held, url.searchParams);
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: JSON.stringify(reply.body),
      });
    },
  );
  return { held, sent };
}
