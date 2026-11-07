// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The release email handler's rights (migration 0029): app_worker holds
// exactly these on the grants and party schemas and the app tables it
// reads, and, with one tenant set, reaches none of another tenant's rows.
// The cross-tenant tests of grants.decision, grants.decision_email,
// grants.email_template_version, party.person and app.audit_event run as
// every role with a grant, app_worker now included.

import { describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { addReleased } from '../grants/decision-fixtures.ts';
import { heldRights } from '../privilege-lint.ts';
import { asMigratorIn, asRoleIn, createTestTenant, outcome } from '../tenants.ts';

const RELEASE_EMAIL_RIGHTS = [
  'USAGE on schema grants',
  'USAGE on schema party',
  'SELECT on grants.decision',
  'SELECT on grants.email_template_version',
  'SELECT on grants.decision_email',
  'UPDATE on column grants.decision_email.status',
  'UPDATE on column grants.decision_email.error_code',
  ...['tenant_id', 'id', 'given_name', 'email'].map(
    (column) => `SELECT on column party.person.${column}`,
  ),
  'SELECT on app.audit_event',
];

describe("app_worker's release email rights", { timeout: 60_000 }, () => {
  it('are exactly those the handler needs in grants, party and the audit table', () =>
    withClient('migrator', async (client) => {
      const held = (await heldRights(client, ['app_worker']))
        .filter(
          ({ schema, object }) =>
            schema === 'grants' || schema === 'party' || object === 'app.audit_event',
        )
        .map(({ privilege, object }) => `${privilege} on ${object}`);
      expect(held.sort()).toEqual([...RELEASE_EMAIL_RIGHTS].sort());
    }));

  it("reach one tenant's release and none of another's", async () => {
    const [tenant, other] = [await createTestTenant(), await createTestTenant()];
    const mine = await asMigratorIn(tenant.id, (client) => addReleased(client, tenant));
    const theirs = await asMigratorIn(other.id, (client) => addReleased(client, other));
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const count = async (table: string, id: string) =>
        (await client.query(`SELECT FROM ${table} WHERE id = $1`, [id])).rowCount;
      expect(await count('grants.decision', mine.decision)).toBe(1);
      expect(await count('grants.decision', theirs.decision)).toBe(0);
      expect(await count('grants.email_template_version', theirs.template)).toBe(0);
      expect(await count('party.person', theirs.parts.person)).toBe(0);
      expect(
        await outcome(client, 'SELECT given_name, family_name FROM party.person'),
        'a column it does not need',
      ).toBe('42501');
      expect(
        await outcome(client, 'UPDATE grants.decision SET outcome = outcome'),
        'a decision',
      ).toBe('42501');
    });
  });
});
