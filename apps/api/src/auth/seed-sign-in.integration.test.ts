// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The development seed's staff sign in through the sign-in route (S02-08).
// The seed's `base` scenario is written to the test database under slugs,
// and so addresses, that no earlier run has used, with a known password.
// Every member's console sign-in waits for an authenticator to be set up, a
// wrong password is refused, and the administrator, once their app is set
// up, works in their own tenant as tenant_admin.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { base } from '../../../../packages/db/seed/base.ts';
import { emailOf, writeScenario, type Scenario } from '../../../../packages/db/seed/scenario.ts';
import { connectionSettings, withClient } from '../../../../packages/db/test/connect.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import type { Sender } from '../email/sender.ts';
import { createLogger } from '../logger.ts';
import { newToken } from './cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from './index.ts';
import { codeAt, stepAt } from './totp.ts';

const ORIGIN = 'https://console.example.org';
const PASSWORD = 'a long synthetic passphrase';

const suffix = randomBytes(4).toString('hex');
const scenario: Scenario = base.map((tenant) => ({ ...tenant, slug: `${tenant.slug}-${suffix}` }));

let app: FastifyInstance;
let auth: Auth;
const sender: Sender = { send: () => Promise.resolve({ sent: true }) };

const newAddress = () => `10.${[...randomBytes(3)].join('.')}`;

function post(path: string, ip: string, payload?: object, token?: string) {
  return app.inject({
    method: 'POST',
    url: `/api${path}`,
    remoteAddress: ip,
    headers: {
      host: 'console.example.org',
      origin: ORIGIN,
      ...(token === undefined ? {} : { cookie: `__Host-tps_console_session=${token}` }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

const tokenOf = (response: LightMyRequestResponse) =>
  /^__Host-tps_console_session=([^;]*);/.exec(String(response.headers['set-cookie']))?.[1];

/** The bytes of a base32 key (RFC 4648), as an authenticator app reads it. */
function fromBase32(key: string): Buffer {
  const bits = key.replace(/[A-Z2-7]/g, (character) =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character).toString(2).padStart(5, '0'),
  );
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
}

beforeAll(async () => {
  await withClient('migrator', (client) => writeScenario(client, scenario, PASSWORD));
  const api = connectionSettings('app_api');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: newToken(),
    TPS_DB_APP_AUTH_PASSWORD: connectionSettings('app_auth').password,
    TPS_CONSOLE_ORIGIN: ORIGIN,
    TPS_PORTAL_ORIGIN: 'https://apply.example.org',
  });
  const logger = createLogger({ level: 'silent' });
  auth = createAuth(settings, {
    database: {
      host: api.host,
      port: api.port,
      database: api.database,
      password: new Secret(api.password),
    },
    log: logger,
    sender,
    commonPasswords: new Set(['synthetic common password']),
  });
  app = await buildApp({ logger, checkDatabase: () => Promise.resolve(), auth });
});

afterAll(async () => {
  await app.close();
  await auth.close();
});

describe("the seed's staff", { timeout: 60_000 }, () => {
  it('each sign in to the console, which waits for them to set up an authenticator', async () => {
    for (const tenant of scenario) {
      for (const member of tenant.staff) {
        const response = await post(`/auth/tenants/${tenant.slug}/sign-in`, newAddress(), {
          email: emailOf(tenant, member),
          password: PASSWORD,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ mfa: 'enrol', activeMembership: null });
      }
    }
  });

  it('are refused with any other password', async () => {
    const [tenant] = scenario;
    const [member] = tenant?.staff ?? [];
    if (tenant === undefined || member === undefined) throw new Error('No seeded member.');
    const response = await post(`/auth/tenants/${tenant.slug}/sign-in`, newAddress(), {
      email: emailOf(tenant, member),
      password: 'not the seed password',
    });
    expect(response.statusCode).toBe(401);
  });

  it('include an administrator who, once their app is set up, works in their own tenant', async () => {
    // base lists each tenant's administrator first.
    const [tenant] = scenario;
    const [administrator] = tenant?.staff ?? [];
    if (tenant === undefined || administrator === undefined) throw new Error('No administrator.');
    const ip = newAddress();
    const signedIn = await post(`/auth/tenants/${tenant.slug}/sign-in`, ip, {
      email: emailOf(tenant, administrator),
      password: PASSWORD,
    });
    const token = tokenOf(signedIn);
    const { key } = (await post('/auth/totp/enrol', ip, undefined, token)).json<{ key: string }>();

    // Keep the code inside one 30-second step.
    const left = 30_000 - (Date.now() % 30_000);
    if (left < 8000) await delay(left + 100);
    const code = codeAt(fromBase32(key), stepAt(Date.now()));
    const confirmed = await post('/auth/totp/confirm', ip, { code }, token);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      mfa: 'complete',
      activeMembership: {
        tenant: { slug: tenant.slug, name: 'Northfield Community Trust' },
        roles: ['tenant_admin'],
      },
    });
  });
});
