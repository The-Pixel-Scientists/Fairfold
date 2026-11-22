// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The public unsubscribe routes through the whole API against the test
// database, as app_api with no session and no tenant: what GET and POST write,
// the audit event the function writes, the repeat, that a token for one
// tenant's person records nothing in another, that an erased person reads as
// any other bad token, and that the route calls the one function and no other
// party object.

import { randomBytes, randomUUID } from 'node:crypto';

import { createDatabase, type Kysely } from '@pixel-scientists/db';
import { apiBasePath } from '@pixel-scientists/domain/api';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addErasureRequest, erase } from '../../../../../packages/db/test/erasure/fixtures.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { smtpTestSettings } from '../../../test/support.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import {
  signUnsubscribeToken,
  unsubscribeKeys,
  type UnsubscribeTarget,
} from '../../email/unsubscribe-token.ts';
import { createLogger } from '../../logger.ts';
import { registerRoutes } from '../../routes/register.ts';
import { createServer } from '../../server.ts';
import { registerUnsubscribeTransport, unsubscribeRoutes, unsubscribeStoreOn } from './index.ts';

// Each request runs a statement on a connection shared with other lanes.
vi.setConfig({ testTimeout: 30_000 });

const keys = unsubscribeKeys(new Map([[1, 'a-secret-of-at-least-thirty-two-characters']]), 1);
const URL = `${apiBasePath}/public/unsubscribe`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const ONE_CLICK = 'List-Unsubscribe=One-Click';

let api: FastifyInstance;
let database: ApiDatabase;
let recording: Kysely<unknown>;
const statements: string[] = [];

let tenantA: TestTenant;
let tenantB: TestTenant;
let memberA: string;

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41006',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  memberA = await asMigratorIn(tenantA.id, (client) => addMember(client, tenantA));

  // The API's own role, on a connection that records what it sends.
  recording = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password: settings.password.reveal(),
    applicationName: 'tps-unsubscribe-test',
    tls: settings.tls,
  }).withPlugin({
    transformQuery: ({ node }) => {
      statements.push(JSON.stringify(node));
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  });

  const server = createServer(createLogger({ level: 'silent' }));
  await server.register(
    (scope) => {
      registerUnsubscribeTransport(scope);
      registerRoutes(scope, unsubscribeRoutes({ keys, store: unsubscribeStoreOn(recording) }), {
        readSession: () => Promise.resolve({ app: null, session: null }),
        inTenant: () => Promise.reject(new Error('No tenant transaction.')),
        resolvers: {},
      });
      return Promise.resolve();
    },
    { prefix: apiBasePath },
  );
  api = server;
}, 90_000);

afterAll(async () => {
  await api.close();
  await database.close();
  await recording.destroy();
});

/** A person in the tenant, consenting by email unless `consented` is false. */
function addConsenting(tenant: TestTenant, memberId: string, consented = true): Promise<string> {
  return asMigratorIn(tenant.id, async (client) => {
    const person = await addPerson(client, tenant);
    if (consented) {
      await insertRow(client, 'party.consent', {
        tenant_id: tenant.id,
        person_id: person,
        purpose: 'future_funding',
        channel: 'email',
        state: 'given',
        privacy_notice_version: '2026-11',
        source: 'portal',
        recorded_by: memberId,
      });
    }
    return person;
  });
}

const tokenFor = (tenant: TestTenant, personId: string, change: Partial<UnsubscribeTarget> = {}) =>
  signUnsubscribeToken(keys, {
    tenantId: tenant.id,
    personId,
    purpose: 'future_funding',
    channel: 'email',
    address: { hash: randomBytes(32), keyVersion: 1 },
    ...change,
  });

const post = (token: string) =>
  api.inject({ method: 'POST', url: `${URL}?token=${token}`, headers: FORM, payload: ONE_CLICK });

/** What is stored about a person and their tenant's audit log, read as the migrator. */
const stored = (tenant: TestTenant, person: string) =>
  asMigratorIn(tenant.id, async (client) => {
    const count = async (text: string, params: unknown[] = []) =>
      Number((await client.query<{ n: string }>(text, params)).rows[0]?.n);
    return {
      consent: await count('SELECT count(*) AS n FROM party.consent WHERE person_id = $1', [
        person,
      ]),
      suppression: await count('SELECT count(*) AS n FROM party.suppression WHERE person_id = $1', [
        person,
      ]),
      audit: await count('SELECT count(*) AS n FROM app.audit_event'),
    };
  });

describe('GET', () => {
  it('writes no consent, suppression or audit row', async () => {
    const person = await addConsenting(tenantA, memberA);
    const before = await stored(tenantA, person);

    const response = await api.inject({ url: `${URL}?token=${tokenFor(tenantA, person)}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ purpose: 'future_funding', channel: 'email' });
    expect(await stored(tenantA, person)).toEqual(before);
  });
});

describe('POST', () => {
  it('records one withdrawal and suppression, audited by the function, and a repeat nothing', async () => {
    const person = await addConsenting(tenantA, memberA);
    const token = tokenFor(tenantA, person);
    statements.length = 0;

    const first = await post(token);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ outcome: 'unsubscribed' });
    expect(await stored(tenantA, person)).toMatchObject({ consent: 2, suppression: 1 });
    const events = await asMigratorIn(
      tenantA.id,
      async (client) =>
        (
          await client.query<{
            action: string;
            actor_kind: string;
            request_id: string;
            entity_type: string;
            changes: Record<string, unknown>;
          }>(
            `SELECT action, actor_kind, request_id, entity_type, changes FROM app.audit_event
            WHERE subject_party_id = $1 ORDER BY action`,
            [person],
          )
        ).rows,
    );
    expect(events.map((event) => [event.action, event.actor_kind, event.entity_type])).toEqual([
      ['party.consent.recorded', 'system', 'party.consent'],
      ['party.suppression.added', 'system', 'party.suppression'],
    ]);
    expect(new Set(events.map((event) => event.request_id))).toEqual(
      new Set([first.headers['x-request-id']]),
    );
    expect(JSON.stringify(events)).not.toContain('example');

    const again = await post(token);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ outcome: 'already_unsubscribed' });
    expect(await stored(tenantA, person)).toMatchObject({ consent: 2, suppression: 1 });
  });

  it('calls the approved function and no other party object, with no tenant set', async () => {
    const person = await addConsenting(tenantA, memberA);
    statements.length = 0;

    await post(tokenFor(tenantA, person));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('party.record_unsubscribe');
    expect(statements[0]?.replaceAll('party.record_unsubscribe', '')).not.toMatch(
      /party|set_config|tenant/i,
    );
  });

  it('records only the suppression when the person never consented', async () => {
    const person = await addConsenting(tenantA, memberA, false);

    expect((await post(tokenFor(tenantA, person))).statusCode).toBe(200);

    expect(await stored(tenantA, person)).toMatchObject({ consent: 0, suppression: 1 });
  });
});

describe('another tenant', () => {
  it('is untouched by a token naming a person who is not in the tenant it names', async () => {
    const memberB = await asMigratorIn(tenantB.id, (client) => addMember(client, tenantB));
    const mine = await addConsenting(tenantA, memberA);
    const theirs = await addConsenting(tenantB, memberB);
    const before = [await stored(tenantA, mine), await stored(tenantB, theirs)];

    // A's person under B's tenant id, and B's person under A's: the pair does not exist.
    const crossed = [tokenFor(tenantB, mine), tokenFor(tenantA, theirs)];
    const answers = await Promise.all(crossed.map((token) => post(token)));

    for (const answer of answers) expect(answer.statusCode).toBe(404);
    expect([await stored(tenantA, mine), await stored(tenantB, theirs)]).toEqual(before);
  });

  it('records for the token’s tenant only', async () => {
    const memberB = await asMigratorIn(tenantB.id, (client) => addMember(client, tenantB));
    const mine = await addConsenting(tenantA, memberA);
    const theirs = await addConsenting(tenantB, memberB);
    const untouched = await stored(tenantB, theirs);

    expect((await post(tokenFor(tenantA, mine))).statusCode).toBe(200);

    expect(await stored(tenantB, theirs)).toEqual(untouched);
  });
});

describe('a refused person', () => {
  it('reads as a forged token for an erased person, an unknown person and an unknown tenant', async () => {
    const person = await addConsenting(tenantA, memberA);
    const request = await asMigratorIn(tenantA.id, (client) =>
      addErasureRequest(client, tenantA, memberA, person),
    );
    expect((await erase(tenantA, person, request)).code).toBeUndefined();
    const forged = await post(`${tokenFor(tenantA, person).slice(0, -2)}AA`);

    const refused = await Promise.all([
      post(tokenFor(tenantA, person)),
      post(tokenFor(tenantA, randomUUID())),
      post(signUnsubscribeToken(keys, { ...target(), tenantId: randomUUID() })),
    ]);

    const shown = (response: { statusCode: number; json: () => object }) => ({
      status: response.statusCode,
      body: { ...response.json(), requestId: undefined },
    });
    for (const response of refused) expect(shown(response)).toEqual(shown(forged));
    expect(forged.statusCode).toBe(404);
  });
});

function target(): UnsubscribeTarget {
  return {
    tenantId: tenantA.id,
    personId: randomUUID(),
    purpose: 'future_funding',
    channel: 'email',
    address: { hash: randomBytes(32), keyVersion: 1 },
  };
}
