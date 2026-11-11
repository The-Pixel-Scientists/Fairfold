// SPDX-License-Identifier: AGPL-3.0-or-later
//
// No tool is on by default (ADR 0024): for each switchable module the policy
// answers 404 with no row and with an off row, 200 with an on row, and
// never for another tenant's row.

import { defineRoute } from '@pixel-scientists/domain/api';
import { switchableModuleIds } from '@pixel-scientists/domain/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestTenant, type TestTenant } from '../../../packages/db/test/tenants.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/database.ts';
import { createLogger } from '../src/logger.ts';
import { route } from '../src/routes/register.ts';
import { switchModule } from './modules-on.ts';
import { addMember, type Member } from './settings-api.ts';
import { smtpTestSettings, testAuth, testSession } from './support.ts';

const permissions = {
  grants: 'grants.data.export',
  crm: 'crm.records.export',
  assure: 'assure.lookup.read',
  forms: 'forms.forms.manage',
  privacy: 'privacy.requests.manage',
  insight: 'insight.reports.read',
  impact: 'impact.frameworks.read',
} as const;

const contracts = switchableModuleIds.map((module) =>
  defineRoute({
    method: 'GET',
    path: `/console/default-check/${module}`,
    audience: 'console',
    module,
    permission: permissions[module],
    scope: 'tenant',
    summary: `A route of the ${module} module`,
    responses: { 200: z.object({ ok: z.boolean() }) },
  }),
);

const { database: settings } = loadConfig({
  ...process.env,
  ...smtpTestSettings,
  TPS_API_PORT: '41091',
  TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
});
const database = openDatabase(settings, createLogger({ level: 'silent' }));
const auth = testAuth();
const api = await buildApp({
  logger: createLogger({ level: 'silent' }),
  checkDatabase: () => database.check(),
  inTenant: database.inTenant,
  auth: auth.module,
  routes: contracts.map((contract) => route(contract, () => Promise.resolve({ ok: true }))),
});

let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let adminB: Member;

beforeAll(async () => {
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
}, 60_000);
afterAll(async () => {
  await api.close();
  await database.close();
});

const status = async (member: Member, module: string) =>
  (
    await api.inject({
      url: `/api/console/default-check/${module}`,
      headers: auth.as({
        app: 'console',
        session: testSession({
          app: 'console',
          userId: member.userId,
          tenant: member.tenant.id,
        }),
      }),
    })
  ).statusCode;

describe('a switchable module with no row', () => {
  it.each(switchableModuleIds)('is off for %s, as an explicit off row is', async (module) => {
    expect(await status(adminA, module)).toBe(404);
    await switchModule(tenantA, module, false);
    expect(await status(adminA, module)).toBe(404);
  });

  it.each(switchableModuleIds)('is on for %s only where the row says so', async (module) => {
    await switchModule(tenantA, module, true);
    // A role may not hold a new tool's permissions yet; 403 still shows the module is on.
    expect(await status(adminA, module)).not.toBe(404);
    expect(await status(adminB, module)).toBe(404);
  });
});
