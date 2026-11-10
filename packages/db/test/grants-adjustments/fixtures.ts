// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the reasonable adjustment, submission route and equality
// monitoring tests (migration 0051).

import type pg from 'pg';

import type { Parts } from '../grants/application-fixtures.ts';
import { insertRow, type Row, type TestTenant } from '../tenants.ts';

/** After every round's closing time in the fixtures. */
export const LATER = '2027-04-30T12:00:00Z';
/** Before every round's closing time in the fixtures. */
export const EARLIER = '2027-03-01T12:00:00Z';

/** A deadline extension's columns, added to adjustmentRow(). */
export const EXTENSION: Row = { kind: 'deadline_extension', closes_at: LATER };

/** A live alternative route for `parts`' organisation in its round, as app_api may insert. */
export function adjustmentRow(tenant: TestTenant, parts: Parts, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    round_id: parts.round,
    organisation_id: parts.organisation,
    kind: 'alternative_route',
    reason_code: 'access_needs',
    granted_by: parts.member,
    ...change,
  };
}

/** Add an adjustment as migrator, with the tenant set. */
export function addAdjustment(
  client: pg.ClientBase,
  tenant: TestTenant,
  parts: Parts,
  change: Row = {},
): Promise<string> {
  return insertRow(client, 'grants.adjustment', adjustmentRow(tenant, parts, change));
}

/** A monitoring response on `application`, as app_api may insert. */
export function responseRow(
  tenant: TestTenant,
  parts: Parts,
  application: string,
  change: Row = {},
): Row {
  return {
    tenant_id: tenant.id,
    round_id: parts.round,
    application_id: application,
    form_version_id: parts.formVersion,
    answers: { f_ethnicity: 'prefer_not_to_say' },
    privacy_notice_version: '2027-01',
    ...change,
  };
}
