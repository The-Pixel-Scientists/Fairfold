// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browsing routes through the whole API against the test database, as
// app_api, with no session: which rounds each tenant's slug shows, that every
// reason a round is hidden reads as one 404, that no tenant is set on the
// connection, and that nothing is audited.

import { createDatabase, type Kysely } from '@pixel-scientists/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  addOpenRound,
  changeIn,
  createGrantsTenant,
  type GrantsTenant,
} from '../../../../../packages/db/test/public-rounds/fixtures.ts';
import { asMigratorIn, testSlug } from '../../../../../packages/db/test/tenants.ts';
import { smtpTestSettings } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, publicTenantsOn, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { composeModules } from '../../modules.ts';

// Each request runs a statement on a connection shared with other lanes.
vi.setConfig({ testTimeout: 30_000 });

let api: FastifyInstance;
let database: ApiDatabase;
let recording: Kysely<unknown>;
const statements: string[] = [];

let tenantA: GrantsTenant;
let tenantB: GrantsTenant;
let roundA: string;
let roundB: string;
const hidden: Record<string, GrantsTenant> = {};

const DAY = 86_400_000;

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41005',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));

  [tenantA, tenantB] = await Promise.all([createGrantsTenant(), createGrantsTenant()]);
  // Both tenants have a round of the same title, so a mix-up shows in the ids.
  [roundA, roundB] = await Promise.all([addOpenRound(tenantA), addOpenRound(tenantB)]);

  const reasons = {
    off: async () => {
      const tenant = await createGrantsTenant(false);
      await addOpenRound(tenant);
      return tenant;
    },
    suspended: async () => {
      const tenant = await createGrantsTenant();
      await addOpenRound(tenant);
      await changeIn(tenant, "UPDATE app.tenant SET status = 'suspended'");
      return tenant;
    },
    closed: async () => {
      const tenant = await createGrantsTenant();
      await addOpenRound(tenant, { closes_at: new Date(Date.now() - DAY) });
      return tenant;
    },
    notYetOpen: async () => {
      const tenant = await createGrantsTenant();
      await addOpenRound(tenant, { opens_at: new Date(Date.now() + DAY) });
      return tenant;
    },
    draftForm: async () => {
      const tenant = await createGrantsTenant();
      await addOpenRound(tenant, {}, null);
      return tenant;
    },
    nothing: () => createGrantsTenant(),
  };
  for (const [reason, make] of Object.entries(reasons)) hidden[reason] = await make();

  // The same function as the API's, on a connection that records what it sends.
  recording = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password: settings.password.reveal(),
    applicationName: 'tps-public-rounds-test',
    tls: settings.tls,
  }).withPlugin({
    transformQuery: ({ node }) => {
      statements.push(JSON.stringify(node));
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  });

  api = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    ...composeModules({ publicTenants: publicTenantsOn(recording) }),
  });
}, 90_000);

afterAll(async () => {
  await api.close();
  await database.close();
  await recording.destroy();
});

const get = (slug: string, rest = 'rounds') =>
  api.inject({ url: `/api/public/tenants/${slug}/${rest}` });

const shown = (response: LightMyRequestResponse) => ({
  status: response.statusCode,
  body: { ...response.json<Record<string, unknown>>(), requestId: undefined },
  headers: { ...response.headers, date: undefined, 'x-request-id': undefined },
});

/** Audit rows in both tenants; row-level security shows each tenant's own. */
const auditRows = async (): Promise<number> => {
  const counts = await Promise.all(
    [tenantA, tenantB].map((tenant) =>
      asMigratorIn(tenant.id, async (client) => {
        const { rows } = await client.query<{ n: string }>(
          'SELECT count(*) AS n FROM app.audit_event',
        );
        return Number(rows[0]?.n);
      }),
    ),
  );
  return counts.reduce((sum, n) => sum + n, 0);
};

describe('which rounds a slug shows', () => {
  it('shows each tenant only its own round, though the titles are the same', async () => {
    const a = await get(tenantA.slug);
    const b = await get(tenantB.slug);

    expect(a.statusCode).toBe(200);
    expect(a.json<{ rounds: { id: string; title: string }[] }>().rounds).toMatchObject([
      { id: roundA, title: 'Round 1' },
    ]);
    expect(b.json<{ rounds: { id: string }[] }>().rounds).toMatchObject([{ id: roundB }]);
  });

  it('reads one round by its id, and gives another tenant’s round id the one 404', async () => {
    const own = await get(tenantA.slug, `rounds/${roundA}`);
    const theirs = await get(tenantA.slug, `rounds/${roundB}`);

    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({
      id: roundA,
      programme: { title: 'Programme A' },
      awardMinimum: { amountMinor: 10_000, currency: 'GBP' },
      awardMaximum: { amountMinor: 500_000, currency: 'GBP' },
      timeZone: 'Europe/London',
      eligibility: [{ label: 'Are you a registered charity?' }, { label: 'Where do you work?' }],
    });
    expect(theirs.statusCode).toBe(404);
  });

  it('sends nothing private: no id of a tenant or programme, description, budget or hint', async () => {
    const text = (await get(tenantA.slug)).body;

    for (const secret of [
      tenantA.id,
      'Private description text',
      '9876543',
      'Hint stays private',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['rounds']);
  });
});

describe('every reason a round is hidden', () => {
  it('reads as the same 404, byte for byte, as an unknown or malformed slug', async () => {
    const unknown = await get(testSlug());
    expect(unknown.statusCode).toBe(404);

    const slugs = [
      ...Object.values(hidden).map((tenant) => tenant.slug),
      tenantA.slug.toUpperCase(),
      'x',
      'bad_slug',
    ];
    for (const slug of slugs) {
      expect(shown(await get(slug)), slug).toEqual(shown(unknown));
      expect(shown(await get(slug, `rounds/${roundA}`)), slug).toEqual(shown(unknown));
    }
    expect(shown(await get(tenantA.slug, 'rounds/not-a-uuid'))).toEqual(shown(unknown));
  });
});

describe('the connection and the audit log', () => {
  it('sets no tenant, and sends one call of the function for each request', async () => {
    statements.length = 0;
    await get(tenantA.slug);
    await get(tenantA.slug, `rounds/${roundA}`);
    await get(hidden['off']?.slug ?? '');

    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement).toContain('grants.public_open_rounds');
      expect(statement).not.toMatch(/set_config|current_setting|app\.tenant_id|BEGIN|SET /i);
    }
  });

  it('writes no audit event', async () => {
    const before = await auditRows();

    await get(tenantA.slug);
    await get(tenantA.slug, `rounds/${roundA}`);
    await get(hidden['closed']?.slug ?? '');

    expect(await auditRows()).toBe(before);
  });
});
