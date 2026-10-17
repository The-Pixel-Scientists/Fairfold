// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The members port against the test database, as app_api: who holds a
// permission is worked out from the roles through permissionsFor(), only
// active members of the request's own tenant count, and no other tenant's
// members show.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { smtpTestSettings, tenantId } from '../../test/support.ts';
import { loadConfig } from '../config.ts';
import { openDatabase, type ApiDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { membersWith } from './members.ts';

let database: ApiDatabase;
let tenantA: TestTenant;
let tenantB: TestTenant;

const add = async (tenant: TestTenant, roles: string[], status = 'active'): Promise<string> => {
  const userId = await createTestUser();
  return asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles, status }),
  );
};

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41044',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('membersWith', () => {
  it('lists the active members whose roles give the permission, by id, in this tenant only', async () => {
    const reviewer = await add(tenantA, ['reviewer']);
    const both = await add(tenantA, ['programme_manager', 'reviewer']);
    const manager = await add(tenantA, ['programme_manager']);
    await add(tenantA, ['applicant']);
    await add(tenantA, ['reviewer'], 'suspended');
    await add(tenantB, ['reviewer']);

    const inA = (permission: Parameters<typeof membersWith>[1]) =>
      database.inTenant(tenantId(tenantA.id), (tx) => membersWith(tx, permission));

    expect(await inA('grants.reviews.score')).toEqual([reviewer, both].sort());
    expect(await inA('grants.reviews.assign')).toEqual([both, manager].sort());
    expect(await inA('grants.data.export')).toEqual([]);
    const inB = await database.inTenant(tenantId(tenantB.id), (tx) =>
      membersWith(tx, 'grants.reviews.score'),
    );
    expect(inB).toHaveLength(1);
    expect(inB).not.toContain(reviewer);
  });
});
