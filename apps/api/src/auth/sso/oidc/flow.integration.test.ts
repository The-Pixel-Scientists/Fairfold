// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The OIDC state record against the test database, as app_auth: kept under
// a hash, never the state, found only with the browser token that started
// it, taken once even by callbacks sent together, and reported when expired.

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createDatabase, type Kysely } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { databaseSettings } from '../../../../../../packages/db/test/connect.ts';
import type { AuthTables } from '../../tables.ts';
import { FLOW_SECONDS, newFlow, saveState, takeState, type Flow } from './flow.ts';

let db: Kysely<unknown>;
const record = () => ({ tenantId: randomUUID(), providerId: randomUUID() });

beforeAll(() => {
  db = createDatabase(databaseSettings('app_auth', 4));
});

afterAll(async () => {
  await db.destroy();
});

const save = (flow: Flow, bound = record()) =>
  db.transaction().execute((trx) => saveState(trx, flow, bound));
const take = (flow: Flow, browser = flow.browser) =>
  db.transaction().execute((trx) => takeState(trx, flow.state, browser));

describe('OIDC state record', () => {
  it('binds tenant, provider, nonce and verifier, and stores no flow value in clear', async () => {
    const flow = newFlow();
    const bound = record();
    await save(flow, bound);
    const stored = await db
      .$extendTables<AuthTables>()
      .selectFrom('auth.verification')
      .select(['identifier', 'value'])
      .where('value', 'like', `%${bound.tenantId}%`)
      .executeTakeFirstOrThrow();
    expect(`${stored.identifier}${stored.value}`).not.toContain(flow.state);
    expect(`${stored.identifier}${stored.value}`).not.toContain(flow.browser);
    expect(await take(flow)).toEqual({
      found: true,
      expired: false,
      record: { ...bound, nonce: flow.nonce, verifier: flow.verifier },
    });
  });

  it('is found only from the browser that started it', async () => {
    const flow = newFlow();
    await save(flow);
    expect(await take(flow, newFlow().browser)).toEqual({ found: false });
    expect((await take(flow)).found).toBe(true);
  });

  it('completes once, even when two callbacks race', async () => {
    const flow = newFlow();
    await save(flow);
    const both = await Promise.all([take(flow), take(flow)]);
    expect(both.filter((taken) => taken.found)).toHaveLength(1);
    expect(await take(flow)).toEqual({ found: false });
  });

  it('reports an expired record, and takes it', async () => {
    const flow = newFlow();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now - (FLOW_SECONDS - 1) * 1000);
    await save(flow);
    vi.restoreAllMocks();
    await delay(1_500);
    expect(await take(flow)).toMatchObject({ found: true, expired: true });
    expect(await take(flow)).toEqual({ found: false });
  });
});
