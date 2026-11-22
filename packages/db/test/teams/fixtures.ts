// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the teams and break-glass tests (migration 0099). Rows are
// added through a client connected as migrator with the tenant set.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { addMember, insertRow, type Row, type TestTenant } from '../tenants.ts';

/** A stand-in for a sealed reason: nonce, at least 20 bytes of text, tag. */
export const SEALED_REASON = Buffer.alloc(48, 7);

export const teamRow = (tenant: TestTenant, by: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  name: `Team ${randomUUID().slice(0, 8)}`,
  created_by: by,
  updated_by: by,
  ...change,
});

export const teamMemberRow = (
  tenant: TestTenant,
  team: string,
  membership: string,
  by: string,
): Row => ({
  tenant_id: tenant.id,
  team_id: team,
  membership_id: membership,
  created_by: by,
  updated_by: by,
});

export const breakGlassRow = (tenant: TestTenant, membership: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  id: randomUUID(),
  membership_id: membership,
  record_type: 'cases.case',
  record_id: randomUUID(),
  reason_code: 'safeguarding_concern',
  reason_text_ciphertext: SEALED_REASON,
  ...change,
});

/** A team made by a new member, as migrator. */
export async function addTeam(client: pg.ClientBase, tenant: TestTenant) {
  const member = await addMember(client, tenant);
  return { member, team: await insertRow(client, 'app.team', teamRow(tenant, member)) };
}
