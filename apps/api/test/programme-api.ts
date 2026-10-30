// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme set-up API for integration tests: the whole application on
// the test database as app_api, with a session stand-in, two tenants with
// their staff, and readers for the rows a request left behind.

import { encodeFileNameHeader } from '@pixel-scientists/domain/files';
import { defaultEmailTemplates } from '@pixel-scientists/grants/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

import { addPerson } from '../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../packages/db/test/tenants.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/database.ts';
import type { FileService } from '../src/platform/files/index.ts';
import { createLogger } from '../src/logger.ts';
import { composeModules, type Mail } from '../src/modules.ts';
import { addMember, type Member } from './settings-api.ts';
import { smtpTestSettings, testAuth, testSession } from './support.ts';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface Programme {
  id: string;
  title: string;
  summary: string;
  description: string;
  status: string;
}

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Round {
  id: string;
  programmeId: string;
  title: string;
  opensAt: string;
  closesAt: string;
  timeZone: string;
  budget: Money;
  awardMinimum: Money;
  awardMaximum: Money;
  latePolicy: string;
}

export interface Criterion {
  id: string;
  label: string;
  guidance: string;
  weight: number;
  scaleMin: number;
  scaleMax: number;
}

export interface Stage {
  id: string;
  name: string;
  position: number;
  criteria: Criterion[];
}

export interface Problem {
  detail: string;
  errors?: { field: string; message: string }[];
}

export interface Change {
  path: string;
  from: unknown;
  to: unknown;
}

export interface StoredVersion {
  version: number;
  author_id: string;
  entity_id: string;
  diff: { changes: Change[] };
}

export const money = (amountMinor: number): Money => ({ amountMinor, currency: 'GBP' });

export const programmeBody = (change: object = {}) => ({
  title: 'Community Spaces Fund',
  summary: 'Grants for groups that run shared spaces.',
  description: 'Money for halls, gardens and workshops.',
  status: 'draft',
  ...change,
});

export const roundBody = (change: object = {}) => ({
  title: 'Autumn 2026',
  opensAt: '2026-10-20T09:00',
  closesAt: '2026-11-03T17:00',
  budget: money(5_000_000),
  awardMinimum: money(100_000),
  awardMaximum: money(2_500_000),
  latePolicy: 'refuse',
  ...change,
});

export const criterionBody = (label: string, change: object = {}) => ({
  label,
  guidance: `How well the application shows ${label.toLowerCase()}.`,
  weight: 2,
  scaleMin: 1,
  scaleMax: 5,
  ...change,
});

/** Every programme set-up route, with a valid request for the ids given. */
export function everyRoute(p: string, r: string, s: string): [Method, string, unknown][] {
  return [
    ['GET', '/console/programmes', undefined],
    ['POST', '/console/programmes', programmeBody()],
    ['GET', `/console/programmes/${p}`, undefined],
    ['PUT', `/console/programmes/${p}`, programmeBody()],
    ['GET', `/console/programmes/${p}/rounds`, undefined],
    ['POST', `/console/programmes/${p}/rounds`, roundBody()],
    ['GET', `/console/rounds/${r}`, undefined],
    ['PUT', `/console/rounds/${r}`, roundBody()],
    ['GET', `/console/rounds/${r}/stages`, undefined],
    ['PUT', `/console/rounds/${r}/stages`, { stages: [{ name: 'Intake' }] }],
    ['PUT', `/console/stages/${s}/rubric`, { criteria: [] }],
    ['GET', `/console/programmes/${p}/email-templates`, undefined],
    ['PUT', `/console/programmes/${p}/email-templates`, defaultEmailTemplates],
    ['GET', `/console/programmes/${p}/history`, undefined],
    ['GET', `/console/rounds/${r}/history`, undefined],
  ];
}

/** The body of a response, which must have the status. */
export async function answer<T>(response: Promise<LightMyRequestResponse>, status = 200) {
  const answered = await response;
  expect(answered.statusCode, answered.body).toBe(status);
  return answered.json<T>();
}

/** Rows read as the migrator, with the tenant set. */
export const rowsOf = <T extends object>(
  tenant: TestTenant,
  text: string,
  values: unknown[] = [],
) => asMigratorIn(tenant.id, async (client) => (await client.query<T>(text, values)).rows);

/** An object's configuration versions in a tenant, oldest first. */
export const storedVersions = (tenant: TestTenant, entityType: string, entityId: string) =>
  rowsOf<StoredVersion>(
    tenant,
    `SELECT version, author_id, entity_id, diff FROM app.config_version
      WHERE entity_type = $1 AND entity_id = $2 ORDER BY version`,
    [entityType, entityId],
  );

/**
 * The application with two tenants. In tenant A: a programme manager, a
 * second one with a name on a person record (`ada`), a reviewer, an
 * administrator and an applicant. In tenant B: a programme manager.
 */
export async function startProgrammeApi(port: string, mail?: Mail, files?: FileService) {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: port,
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'silent' });
  const database = openDatabase(settings, logger);
  const auth = testAuth();
  const api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    files,
    auth: auth.module,
    ...composeModules({ publicTenants: database.publicTenants, mail }),
  });

  const [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  const managerA = await addMember(tenantA, 'console', 'programme_manager');
  const ada = await addMember(tenantA, 'console', 'programme_manager');
  await asMigratorIn(tenantA.id, (client) =>
    addPerson(client, tenantA, { user_id: ada.userId, given_name: 'Ada', family_name: 'Lovelace' }),
  );
  const members = {
    managerA,
    ada,
    reviewerA: await addMember(tenantA, 'console', 'reviewer'),
    adminA: await addMember(tenantA, 'console', 'tenant_admin'),
    applicantA: await addMember(tenantA, 'portal', 'applicant'),
    managerB: await addMember(tenantB, 'console', 'programme_manager'),
  };

  /** A request as `member` (in `app`, if not the member's own) or signed out. */
  const sessionHeaders = (
    member: Member,
    app: 'console' | 'portal' = member.app,
    recentAuthAt: Date | null = null,
  ) =>
    auth.as({
      app,
      session: testSession({ app, userId: member.userId, tenant: member.tenant.id, recentAuthAt }),
    });

  const send = (
    member: Member | undefined,
    method: Method,
    url: string,
    payload?: unknown,
    app: 'console' | 'portal' = member?.app ?? 'console',
    recentAuthAt: Date | null = null,
  ) =>
    api.inject({
      method,
      url: `/api${url}`,
      ...(member === undefined ? {} : { headers: sessionHeaders(member, app, recentAuthAt) }),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** A raw upload: the file's bytes as the body, its name in the `File-Name` header. */
  const upload = (member: Member | undefined, url: string, name: string, bytes: Buffer) =>
    api.inject({
      method: 'POST',
      url: `/api${url}`,
      headers: {
        'content-type': 'application/octet-stream',
        'file-name': encodeFileNameHeader(name),
        ...(member === undefined ? {} : sessionHeaders(member)),
      },
      payload: bytes,
    });

  /** A programme and a round made by the manager of tenant A, for the tests that need them. */
  const aProgramme = (change: object = {}) =>
    answer<Programme>(send(managerA, 'POST', '/console/programmes', programmeBody(change)), 201);
  const aRound = (programmeId: string, change: object = {}) =>
    answer<Round>(
      send(managerA, 'POST', `/console/programmes/${programmeId}/rounds`, roundBody(change)),
      201,
    );
  const stagesOf = async (roundId: string) =>
    (await answer<{ stages: Stage[] }>(send(managerA, 'GET', `/console/rounds/${roundId}/stages`)))
      .stages;

  return {
    tenantA,
    tenantB,
    ...members,
    send,
    upload,
    aProgramme,
    aRound,
    stagesOf,
    async close() {
      await api.close();
      await database.close();
    },
  };
}

export type ProgrammeApi = Awaited<ReturnType<typeof startProgrammeApi>>;
