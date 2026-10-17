// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The settings API for integration tests: the whole application on the test
// database as app_api, with a session stand-in, a route of the grants module
// to see the module switch, and readers for configuration versions and audit
// events.

import { defineRoute } from '@pixel-scientists/domain/api';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { z } from 'zod';

import {
  asMigratorIn,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../packages/db/test/tenants.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/database.ts';
import { createLogger } from '../src/logger.ts';
import { composeModules } from '../src/modules.ts';
import { route } from '../src/routes/register.ts';
import { smtpTestSettings, testAuth, testSession } from './support.ts';

export interface Member {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenant: TestTenant;
  readonly app: 'console' | 'portal';
}

export type Method = 'GET' | 'PUT' | 'PATCH' | 'DELETE';

export interface Version {
  version: number;
  author_id: string;
  entity_id: string;
  diff: { changes: { field: string; from: unknown; to: unknown }[] };
}

export interface Event {
  action: string;
  entity_id: string;
  actor_id: string;
  changes: Record<string, { before?: unknown; after?: unknown }>;
}

const programmes = defineRoute({
  method: 'GET',
  path: '/console/module-switch-check',
  audience: 'console',
  module: 'grants',
  permission: 'grants.data.export',
  scope: 'tenant',
  summary: 'A route of the grants module',
  responses: { 200: z.object({ ok: z.boolean() }) },
});

export async function addMember(
  tenant: TestTenant,
  app: 'console' | 'portal',
  role: string,
): Promise<Member> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles: [role] }),
  );
  return { userId, membershipId, tenant, app };
}

/** A PNG header the logo check accepts, with the given size and an optional animation chunk. */
export function png(width = 40, height = 20, animated = false): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  if (!animated) return header;
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write('acTL', 4, 'ascii');
  return Buffer.concat([header, chunk]);
}

export async function startSettingsApi(port: string) {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: port,
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const database = openDatabase(settings, createLogger({ level: 'silent' }));
  const auth = testAuth();
  const composed = composeModules({ publicTenants: database.publicTenants });
  const api = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    ...composed,
    routes: [...composed.routes, route(programmes, () => Promise.resolve({ ok: true }))],
  });

  const as = (member: Member): Record<string, string> => {
    const session = testSession({
      app: member.app,
      userId: member.userId,
      tenant: member.tenant.id,
    });
    return auth.as({ app: member.app, session });
  };

  return {
    database,
    /** A request to a settings route, as `member` or signed out. */
    call: (member: Member | undefined, method: Method, path: string, payload?: object) =>
      api.inject({
        method,
        url: `/api/console/settings${path}`,
        ...(member === undefined ? {} : { headers: as(member) }),
        ...(payload === undefined ? {} : { payload }),
      }),
    /** A request to the grants module's route. */
    grants: (member: Member) =>
      api.inject({ url: '/api/console/module-switch-check', headers: as(member) }),
    /** A request to the console settings route, as the administrator's own account in the portal. */
    asPortal: (member: Member) =>
      api.inject({
        url: '/api/console/settings',
        headers: auth.as({
          app: 'portal',
          session: testSession({ app: 'portal', userId: member.userId, tenant: member.tenant.id }),
        }),
      }),
    async close() {
      await api.close();
      await database.close();
    },
  };
}

export type SettingsApi = Awaited<ReturnType<typeof startSettingsApi>>;

export async function ok<T>(response: Promise<LightMyRequestResponse>): Promise<T> {
  const answered = await response;
  expect(answered.statusCode, answered.body).toBe(200);
  return answered.json<T>();
}

export const versions = (tenant: TestTenant, entityType: string): Promise<Version[]> =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<Version>(
      `SELECT version, author_id, entity_id, diff FROM app.config_version
        WHERE entity_type = $1 ORDER BY version`,
      [entityType],
    );
    return rows;
  });

export const events = (tenant: TestTenant, action: string): Promise<Event[]> =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<Event>(
      `SELECT action, entity_id, actor_id, changes FROM app.audit_event
        WHERE action = $1 ORDER BY occurred_at, id`,
      [action],
    );
    return rows;
  });
