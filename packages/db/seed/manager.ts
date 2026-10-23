// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme manager the journeys sign in as, and setting up their
// authenticator app on a seeded stack, so the journeys run in CI:
//
//   node packages/db/seed/manager.ts <stack console port> <env file>
//
// It signs in as the manager through the stack's console on 127.0.0.1, sets
// up the app, and writes TPS_E2E_MANAGER_EMAIL, TPS_E2E_MANAGER_PASSWORD and
// TPS_E2E_MANAGER_TOTP_KEY to <env file>, readable by this user only, for
// `docker run --env-file`. Every value is synthetic and none is kept in the
// repository: the address is the seed's, the password is the seed password
// (TPS_SEED_PASSWORD or TPS_SEED_PASSWORD_FILE, as for the seed), and the key
// is the one the stack makes now. None of them is printed.

import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';

import { permissionsFor } from '@pixel-scientists/domain/platform';

import { base } from './base.ts';
import { emailOf, MANAGER } from './scenario.ts';
import { readSeedPassword } from './seed.ts';

const SESSION_COOKIE = '__Host-tps_console_session';
const STEP_MS = 30_000;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Northfield's first member who may do what the seed's manager does, in the base scenario every scenario builds on. */
export function seedManager(): { slug: string; email: string } {
  const tenant = base.find(({ slug }) => slug === 'northfield');
  const member = tenant?.staff.find(([, , role]) => {
    const granted = permissionsFor([role], 'console');
    return MANAGER.every((permission) => granted.includes(permission));
  });
  if (tenant === undefined || member === undefined) {
    throw new Error("The seed's base scenario has no Northfield programme manager.");
  }
  return { slug: tenant.slug, email: emailOf(tenant, member) };
}

/** The code an authenticator app shows for a base32 key at `ms` (RFC 6238: SHA-1, 30 s, 6 digits). */
export function totp(key: string, ms: number): string {
  const bits = Array.from(key, (letter) => BASE32.indexOf(letter).toString(2).padStart(5, '0'));
  const bytes = (bits.join('').match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(ms / STEP_MS)));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const value = mac.readUInt32BE((mac.at(-1) ?? 0) & 0xf) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}

/** The console session token in a response's Set-Cookie headers, if there is one. */
export function sessionToken(setCookie: readonly string[] = []): string | undefined {
  const prefix = `${SESSION_COOKIE}=`;
  const cookie = setCookie.find((header) => header.startsWith(prefix));
  return cookie?.slice(prefix.length).split(';')[0] || undefined;
}

/** The lines of a `docker run --env-file`, which takes each value to the end of its line. */
export function envFile(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([name, value]) => {
      if (value === '' || /[\r\n]/.test(value))
        throw new Error(`${name} cannot go in an env file.`);
      return `${name}=${value}\n`;
    })
    .join('');
}

interface Answer {
  readonly body: unknown;
  readonly token: string | undefined;
}

/** A POST to the stack's API through its console, with the console's own Host and Origin. */
function post(port: number, path: string, body?: object, token?: string): Promise<Answer> {
  const host = `console.localhost:${String(port)}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/api${path}`,
        headers: {
          host,
          origin: `http://${host}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token === undefined ? {} : { cookie: `${SESSION_COOKIE}=${token}` }),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          // The answer may repeat what was sent, so only the status is told.
          if (status < 200 || status > 299) {
            reject(new Error(`POST ${path} answered ${String(status)}.`));
            return;
          }
          resolve({
            body: text === '' ? undefined : (JSON.parse(text) as unknown),
            token: sessionToken(response.headers['set-cookie']),
          });
        });
      },
    );
    sent.on('error', reject);
    sent.end(payload);
  });
}

async function main(argv: readonly string[]): Promise<void> {
  const [portText = '', file, ...rest] = argv.filter((argument) => argument !== '--');
  const port = Number(portText);
  if (!/^[0-9]{1,5}$/.test(portText) || port > 65_535 || file === undefined || rest.length > 0) {
    throw new Error('Usage: node packages/db/seed/manager.ts <stack console port> <env file>');
  }
  const { slug, email } = seedManager();
  const password = readSeedPassword(process.env);

  const { token } = await post(port, `/auth/tenants/${slug}/sign-in`, { email, password });
  if (token === undefined) throw new Error('Signing in set no session.');
  const { key } = ((await post(port, '/auth/totp/enrol', undefined, token)).body ?? {}) as {
    key?: unknown;
  };
  if (typeof key !== 'string') throw new Error('Setting up the app gave no key.');
  const now = Date.now();
  await post(port, '/auth/totp/confirm', { code: totp(key, now) }, token);

  // Each code works once, and the journeys sign in with the code of the
  // moment, so wait until the one just spent has gone.
  const next = (Math.floor(now / STEP_MS) + 1) * STEP_MS;
  await new Promise((resolve) => setTimeout(resolve, next - Date.now() + 1000));

  const values = {
    TPS_E2E_MANAGER_EMAIL: email,
    TPS_E2E_MANAGER_PASSWORD: password,
    TPS_E2E_MANAGER_TOTP_KEY: key,
  };
  writeFileSync(file, envFile(values), { mode: 0o600 });
  console.log(`Set up the authenticator app of ${email}; the journeys' settings are in ${file}.`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
