// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reads the audit log as the funder's administrator does, through a session
// that holds `platform.audit.read`.

import type { APIRequestContext } from '@playwright/test';

import { expect } from '../../scripts/e2e/fixtures.ts';
import type { Api } from './api.ts';

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  actor: { kind: string; membershipId?: string; name?: string | null };
  changes: Record<string, { before?: unknown; after?: unknown }>;
}

interface Page {
  events: AuditEvent[];
  nextCursor: string | null;
}

/** Every event that matches the filters, newest first, across pages. */
export async function auditEvents(
  session: APIRequestContext | Api,
  filters: Record<string, string> = {},
): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ ...filters, ...(cursor === null ? {} : { cursor }) });
    const path = `/console/audit-events?${query.toString()}`;
    let page: Page;
    if ('ok' in session) {
      page = await session.ok<Page>('GET', path);
    } else {
      const response = await session.get(`/api${path}`);
      expect(response.status(), path).toBe(200);
      page = (await response.json()) as Page;
    }
    events.push(...page.events);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return events;
}

/**
 * What each step of the journey changed, and how many events it wrote: a number is exact, a range a floor. */
export const expectedEvents: Record<string, number | [number]> = {
  'platform.module.switched_off': 1,
  'platform.module.switched_on': 1,
  'platform.invitation.sent': 1,
  'platform.membership.roles_changed': 1,
  'platform.auth.invitation_accepted': 1,
  'platform.file.uploaded': 7,
  'platform.file.refused': 1,
  'platform.file.downloaded': [2],
  'platform.warehouse.exported': 1,
  'grants.programme.created': 1,
  'grants.programme.email_templates_changed': 1,
  'grants.round.created': 1,
  'grants.stage.rubric_changed': [1],
  'grants.form_version.created': 1,
  'grants.form_version.updated': [1],
  'grants.form_version.published': 1,
  'grants.application.created': 7,
  'grants.application.eligibility_checked': [7],
  'grants.application.submitted': 7,
  'grants.application.withdrawn': 1,
  'grants.application.stage_changed': [5],
  'grants.reviewer.added': 2,
  'grants.assignment.created': 10,
  'grants.assignment.conflict_declared': 1,
  'grants.review.submitted': 9,
  'grants.decision.recorded': 6,
  'grants.decision.released': 6,
  'grants.decision_email.sent': 6,
  // The file from the Data page, and the call that step 14 makes to show the route needs no programme role.
  'grants.export.downloaded': 2,
  'grants.publisher_setting.changed': 1,
};

/** The events of each action, one query for each so that a page never runs past the log's first. */
export async function eventsByAction(
  session: APIRequestContext | Api,
  actions: readonly string[],
): Promise<Map<string, AuditEvent[]>> {
  const found = new Map<string, AuditEvent[]>();
  for (const action of actions) found.set(action, await auditEvents(session, { action }));
  return found;
}
