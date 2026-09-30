// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The roles script against a real PostgreSQL server. These tests connect as
// the superuser, so they run in the db-admin Vitest project (`pnpm test:db`).
// They change only what the roles script itself sets, and leave the roles as
// the development environment expects them.

import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import {
  applyDatabasePrivileges,
  applyRoles,
  applyRoleVerifiers,
  findRoleProblems,
  LOGIN_ROLES,
  readRolePassword,
  type LoginRole,
} from './roles.ts';
import { scramSha256Verifier } from './scram.ts';
import { MAINTENANCE_DATABASE, readDatabaseName, readServer, readSetting } from './settings.ts';

const env = process.env;
const testDatabase = readDatabaseName(env, 'PIXELGRANT_TEST_DB_NAME');

async function connect(database: string, user?: LoginRole): Promise<pg.Client> {
  const client = new pg.Client({
    ...readServer(env),
    database,
    user: user ?? readSetting(env, 'PIXELGRANT_DB_SUPERUSER'),
    password: user
      ? readRolePassword(env, user)
      : readSetting(env, 'PIXELGRANT_DB_SUPERUSER_PASSWORD'),
  });
  await client.connect();
  return client;
}

async function withClient<T>(
  database: string,
  work: (client: pg.Client) => Promise<T>,
  user?: LoginRole,
): Promise<T> {
  const client = await connect(database, user);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function developmentVerifiers(): Record<LoginRole, string> {
  return Object.fromEntries(
    LOGIN_ROLES.map((role) => [role, scramSha256Verifier(readRolePassword(env, role))]),
  ) as Record<LoginRole, string>;
}

/** Run roles.sql with these verifiers and return the error it fails with. */
async function failureWith(
  verifiers: Record<LoginRole, string>,
  before?: string,
): Promise<pg.DatabaseError> {
  const client = await connect(MAINTENANCE_DATABASE);
  let failure: unknown;
  try {
    if (before) await client.query(before);
    await applyRoleVerifiers(client, verifiers);
  } catch (error) {
    failure = error;
  } finally {
    await client.end();
  }
  expect(failure).toBeInstanceOf(Error);
  return failure as pg.DatabaseError;
}

/** Every field the server can send with an error, and everything that would reach a log. */
function reported(error: pg.DatabaseError): string {
  return JSON.stringify([
    error.message,
    error.stack,
    error.detail,
    error.hint,
    error.where,
    error.internalQuery,
    error.internalPosition,
    error.position,
    error.schema,
    error.table,
    error.column,
    error.dataType,
    error.constraint,
    error.routine,
  ]);
}

async function expectRolesUnchanged(): Promise<void> {
  for (const role of LOGIN_ROLES) {
    const problems = await withClient(testDatabase, (client) => findRoleProblems(client), role);
    expect(problems).toEqual([]);
  }
}

describe('roles.sql', () => {
  it('sets every role up so that it can log in with its password', async () => {
    await withClient(MAINTENANCE_DATABASE, (client) => applyRoles(client, env));
    await withClient(testDatabase, (client) => applyDatabasePrivileges(client));

    for (const role of LOGIN_ROLES) {
      const problems = await withClient(testDatabase, (client) => findRoleProblems(client), role);
      expect(problems).toEqual([]);
    }
  });

  it('never repeats a password verifier in its errors', async () => {
    const verifiers = developmentVerifiers();
    // passwordcheck refuses a password equal to the role name, which makes
    // the password statement for app_queue, the last role, fail.
    verifiers.app_queue = scramSha256Verifier('app_queue');
    const secretParts = verifiers.app_queue.split(/[$:]/).slice(2);

    const error = await failureWith(verifiers, "LOAD 'passwordcheck'");

    expect(error.message).toBe('Could not set the password for role app_queue (SQLSTATE 22023).');
    for (const part of secretParts) {
      expect(reported(error)).not.toContain(part);
    }
    // The failed run changed nothing: every role still logs in with its password.
    await expectRolesUnchanged();
  });

  it.each([
    ['one iteration', scramSha256Verifier('a-long-enough-password', randomBytes(16), 1)],
    ['4095 iterations', scramSha256Verifier('a-long-enough-password', randomBytes(16), 4095)],
    ['an 8-byte salt', scramSha256Verifier('a-long-enough-password', randomBytes(8))],
    ['a malformed verifier', 'SCRAM-SHA-256$4096:c2FsdA==$c3RvcmVk:c2VydmVy'],
    ['a password in clear', 'a-long-enough-password'],
  ])('refuses %s', async (_, weak) => {
    const verifiers = developmentVerifiers();
    verifiers.app_api = weak;

    const error = await failureWith(verifiers);

    expect(error.message).toBe(
      'Set a SCRAM-SHA-256 verifier with at least 4096 iterations for role app_api before running the roles script.',
    );
    expect(reported(error)).not.toContain(weak);
    await expectRolesUnchanged();
  });

  it('refuses a verifier PostgreSQL would not store as given', async () => {
    const verifiers = developmentVerifiers();
    // Well formed to the pattern, but the salt is not valid base64, so the
    // server would hash the whole string as if it were a password.
    const [, , keys] = verifiers.app_api.split('$');
    verifiers.app_api = `SCRAM-SHA-256$4096:${'A'.repeat(22)}$${keys ?? ''}`;

    const error = await failureWith(verifiers);

    expect(error.message).toBe(
      'The password for role app_api was not stored as the verifier given.',
    );
    await expectRolesUnchanged();
  });

  it('runs from several sessions and databases at once', async () => {
    const runs = Array.from({ length: 6 }, (_, index) =>
      index % 2 === 0
        ? withClient(MAINTENANCE_DATABASE, (client) => applyRoles(client, env))
        : withClient(testDatabase, async (client) => {
            await applyRoles(client, env);
            await applyDatabasePrivileges(client);
          }),
    );
    await expect(Promise.all(runs)).resolves.toBeDefined();
  });
});
