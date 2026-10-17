// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.invitation (migration 0015): isolation, what app_api and app_worker
// may do, the checks on each column, one pending invitation per address,
// the database's 7-day expiry and a final row that never changes.

import { randomBytes } from 'node:crypto';

import { roles } from '@pixel-scientists/domain/platform';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  testSlug,
  type Row,
  type TestTenant,
} from '../tenants.ts';

/** A tenant with an administrator, and another tenant with its own. */
let tenant: TestTenant;
let other: TestTenant;
let admin: string;
let stranger: string;
beforeAll(async () => {
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  admin = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

function invitation(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    email: `${testSlug()}@example.test`,
    roles: ['reviewer'],
    token_hash: randomBytes(32),
    created_by: admin,
    updated_by: admin,
    ...change,
  };
}

/** An invitation as the operator adds it, with no inviter. */
function fromOperator(): Row {
  return Object.fromEntries(
    Object.entries(invitation()).filter(([column]) => !column.endsWith('_by')),
  );
}

const addInvitation = (client: pg.ClientBase, change: Row = {}) =>
  insertRow(client, 'app.invitation', invitation(change));

describe('app.invitation', { timeout: 30_000 }, () => {
  it("keeps each tenant's invitations from every other tenant", async () => {
    await expectCrossTenantDenial('app.invitation', async (client, owner) => {
      const member = await addMember(client, owner);
      return { ...invitation(), tenant_id: owner.id, created_by: member, updated_by: member };
    });
  });

  it('lets app_api add, read and settle invitations as a member, but not delete or edit them', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.invitation', invitation());
      expect(await outcome(client, text, values)).toBe('ok');
      const unsigned = insertStatement(client, 'app.invitation', fromOperator());
      expect(await outcome(client, unsigned.text, unsigned.values), 'no inviter').toBe('42501');
      const set = insertStatement(client, 'app.invitation', {
        ...invitation(),
        expires_at: new Date(Date.now() + 365 * 86_400_000),
      });
      expect(await outcome(client, set.text, set.values), 'its own expiry').toBe('42501');

      const id = await addInvitation(client);
      const revoked = await client.query(
        `UPDATE app.invitation SET status = 'revoked', updated_by = $2 WHERE id = $1
         RETURNING status`,
        [id, admin],
      );
      expect(revoked.rows).toEqual([{ status: 'revoked' }]);
      const next = await addInvitation(client);
      expect(
        await outcome(client, `UPDATE app.invitation SET updated_by = NULL WHERE id = $1`, [next]),
        'no updater',
      ).toBe('42501');
      for (const change of [
        'email = email',
        'roles = roles',
        'token_hash = token_hash',
        'expires_at = expires_at',
        'created_by = created_by',
        'tenant_id = tenant_id',
      ]) {
        expect(await outcome(client, `UPDATE app.invitation SET ${change}`), change).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.invitation')).toBe('42501');
    });
  });

  it('lets app_worker add only an invitation with no inviter, and nothing else', async () => {
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.invitation', fromOperator());
      expect(await outcome(client, text, values)).toBe('ok');
      const signed = insertStatement(client, 'app.invitation', invitation());
      expect(await outcome(client, signed.text, signed.values), 'an inviter').toBe('42501');
      for (const statement of [
        'SELECT 1 FROM app.invitation',
        "UPDATE app.invitation SET status = 'revoked'",
        'DELETE FROM app.invitation',
      ]) {
        expect(await outcome(client, statement), statement).toBe('42501');
      }
    });
  });

  it.each([
    ['refuses an address in capitals', { email: 'Jo@example.test' }, '23514'],
    ['refuses an address with spaces', { email: ' jo@example.test' }, '23514'],
    ['refuses something that is not an address', { email: 'jo.example.test' }, '23514'],
    ['refuses no roles', { roles: [] }, '23514'],
    ['refuses the applicant role', { roles: ['applicant'] }, '23514'],
    ['refuses an unknown role', { roles: ['owner'] }, '23514'],
    ['refuses a null role', { roles: [null] }, '23514'],
    ['refuses a short token hash', { token_hash: randomBytes(16) }, '23514'],
    ['refuses an unknown status', { status: 'expired' }, '23514'],
    ['refuses an acceptance with no membership', { status: 'accepted' }, '23514'],
    ['refuses a membership while pending', { accepted_membership_id: 'admin' }, '23514'],
    [
      'refuses an expiry other than 7 days',
      { expires_at: new Date(Date.now() + 30 * 86_400_000) },
      '23514',
    ],
    ['refuses an inviter from another tenant', { created_by: 'stranger' }, '23503'],
    ['refuses an updater from another tenant', { updated_by: 'stranger' }, '23503'],
    [
      'refuses a membership from another tenant',
      { status: 'accepted', accepted_membership_id: 'stranger' },
      '23503',
    ],
    [
      'accepts an acceptance with its membership',
      { status: 'accepted', accepted_membership_id: 'admin' },
      'ok',
    ],
  ])('%s', async (_, change: Row, expected) => {
    const members: Record<string, string> = { admin, stranger };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' && Object.hasOwn(members, value) ? members[value] : value,
      ]),
    );
    await asRoleIn('migrator', tenant.id, async (client) => {
      const { text, values: params } = insertStatement(
        client,
        'app.invitation',
        invitation(values),
      );
      expect(await outcome(client, text, params)).toBe(expected);
    });
  });

  it('makes a new invitation pending, for exactly 7 days from now', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await addInvitation(client);
      const { rows } = await client.query(
        `SELECT status, EXTRACT(EPOCH FROM expires_at - created_at)::integer AS seconds,
                created_at = now() AS now
           FROM app.invitation WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ status: 'pending', seconds: 7 * 86_400, now: true }]);
    });
  });

  it('keeps one pending invitation per address in a tenant, and each token once', async () => {
    const email = `${testSlug()}@example.test`;
    await asRoleIn('migrator', other.id, (client) =>
      addInvitation(client, {
        tenant_id: other.id,
        email,
        created_by: stranger,
        updated_by: stranger,
      }),
    );
    await asRoleIn('migrator', tenant.id, async (client) => {
      const again = insertStatement(client, 'app.invitation', invitation({ email }));
      const first = await addInvitation(client, { email });
      expect(await outcome(client, again.text, again.values)).toBe('23505');
      await client.query("UPDATE app.invitation SET status = 'revoked' WHERE id = $1", [first]);
      expect(await outcome(client, again.text, again.values)).toBe('ok');

      const used = randomBytes(32);
      await addInvitation(client, { token_hash: used });
      const reused = insertStatement(client, 'app.invitation', invitation({ token_hash: used }));
      expect(await outcome(client, reused.text, reused.values)).toBe('23505');
    });
  });

  it.each(['accepted', 'revoked'])('never changes an invitation once %s', async (status) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await addInvitation(client);
      await client.query(
        'UPDATE app.invitation SET status = $2, accepted_membership_id = $3 WHERE id = $1',
        [id, status, status === 'accepted' ? admin : null],
      );
      for (const change of [
        "status = 'pending', accepted_membership_id = NULL",
        'updated_by = NULL',
      ]) {
        expect(
          await outcome(client, `UPDATE app.invitation SET ${change} WHERE id = $1`, [id]),
          change,
        ).toBe('55000');
      }
    });
  });

  it('allows exactly the console roles in the domain package', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conrelid = 'app.invitation'::regclass AND conname = 'invitation_roles_check'`,
      ),
    );
    const allowed = [...(rows[0]?.definition ?? '').matchAll(/'([a-z_]+)'::text/g)].map(
      (match) => match[1],
    );
    const consoleRoles = Object.entries(roles)
      .filter(([, role]) => role.app === 'console')
      .map(([id]) => id);
    expect(allowed.sort()).toEqual(consoleRoles.sort());
  });
});
