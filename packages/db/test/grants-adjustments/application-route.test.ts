// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.application.submission_route and submitted_by (migration 0051):
// a check on each, fixed once submitted, and staff submitting only with a
// live alternative route for the organisation in the round.

import { beforeAll, describe, expect, it } from 'vitest';

import { addApplication, type Parts } from '../grants/application-fixtures.ts';
import { asMigratorIn, asRoleIn, createTestTenant, outcome, type TestTenant } from '../tenants.ts';
import { addAdjustment } from './fixtures.ts';

const SUBMIT =
  "UPDATE grants.application SET status = 'submitted', stage_id = $2, submitted_by = $3 WHERE id = $1";

let tenant: TestTenant;
let strangersMember: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  strangersMember = await asMigratorIn(stranger.id, async (client) => {
    const { parts } = await addApplication(client, stranger);
    return parts.member;
  });
}, 60_000);

/** An assisted draft and what it refers to. */
function assistedDraft(): Promise<{ id: string; parts: Parts }> {
  return asMigratorIn(tenant.id, async (client) => {
    const added = await addApplication(client, tenant);
    await client.query(
      "UPDATE grants.application SET submission_route = 'assisted' WHERE id = $1",
      [added.id],
    );
    return added;
  });
}

describe('grants.application submission route', { timeout: 30_000 }, () => {
  it('leaves a new application on the portal route, with no submitter', async () => {
    const { rows } = await asMigratorIn(tenant.id, async (client) => {
      const { id } = await addApplication(client, tenant);
      return client.query<{ submission_route: string; submitted_by: string | null }>(
        'SELECT submission_route, submitted_by FROM grants.application WHERE id = $1',
        [id],
      );
    });
    expect(rows[0]).toEqual({ submission_route: 'portal', submitted_by: null });
  });

  it('refuses an unknown route, and a submitter on a draft or a portal application', async () => {
    const { id, parts } = await assistedDraft();
    const portal = await asMigratorIn(tenant.id, (client) => addApplication(client, tenant));
    await asRoleIn('app_api', tenant.id, async (client) => {
      const route = 'UPDATE grants.application SET submission_route = $2 WHERE id = $1';
      expect(await outcome(client, route, [id, 'post']), 'route').toBe('23514');
      const member = 'UPDATE grants.application SET submitted_by = $2 WHERE id = $1';
      expect(await outcome(client, member, [id, parts.member]), 'draft').toBe('23514');
      expect(
        await outcome(client, SUBMIT, [portal.id, portal.parts.stages[0], portal.parts.member]),
        'portal',
      ).toBe('23514');
    });
  });

  it('refuses an assisted submission with no live alternative route', async () => {
    const { id, parts } = await assistedDraft();
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, SUBMIT, [id, parts.stages[0], parts.member]), 'none').toBe(
        '55000',
      );
    });
    await asMigratorIn(tenant.id, async (client) => {
      const adjustment = await addAdjustment(client, tenant, parts);
      await client.query(
        "UPDATE grants.adjustment SET revoked_by = $2, revoke_reason_code = 'other' WHERE id = $1",
        [adjustment, parts.member],
      );
    });
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, SUBMIT, [id, parts.stages[0], parts.member]), 'revoked').toBe(
        '55000',
      );
    });
  });

  it('refuses a live route for another organisation or round', async () => {
    const { id, parts } = await assistedDraft();
    const other = await asMigratorIn(tenant.id, (client) => addApplication(client, tenant));
    await asMigratorIn(tenant.id, (client) => addAdjustment(client, tenant, other.parts));
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, SUBMIT, [id, parts.stages[0], parts.member])).toBe('55000');
    });
  });

  it('needs a member of the tenant, and fixes the route once submitted', async () => {
    const { id, parts } = await assistedDraft();
    await asMigratorIn(tenant.id, (client) => addAdjustment(client, tenant, parts));
    await asRoleIn('app_api', tenant.id, async (client) => {
      const stage = parts.stages[0];
      expect(await outcome(client, SUBMIT, [id, stage, null]), 'no member').toBe('23514');
      expect(await outcome(client, SUBMIT, [id, stage, strangersMember]), 'stranger').toBe('23503');
      expect(await outcome(client, SUBMIT, [id, stage, parts.member]), 'submitted').toBe('ok');
      await client.query(SUBMIT, [id, stage, parts.member]);
      const route = 'UPDATE grants.application SET submission_route = $2 WHERE id = $1';
      expect(await outcome(client, route, [id, 'portal']), 'route').toBe('55000');
      const member = 'UPDATE grants.application SET submitted_by = NULL WHERE id = $1';
      expect(await outcome(client, member, [id]), 'submitter').toBe('55000');
    });
  });

  it('lets the subject access export read the route but not who submitted', async () => {
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await outcome(client, 'SELECT submission_route FROM grants.application')).toBe('ok');
      expect(await outcome(client, 'SELECT submitted_by FROM grants.application')).toBe('42501');
    });
  });

  it('lets a portal application submit with no adjustment', async () => {
    const { id, parts } = await asMigratorIn(tenant.id, (client) => addApplication(client, tenant));
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, SUBMIT, [id, parts.stages[0], null])).toBe('ok');
    });
  });
});
