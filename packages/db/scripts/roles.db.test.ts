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
  OWNER_ROLES,
  readRolePassword,
  type LoginRole,
} from './roles.ts';
import { scramSha256Verifier } from './scram.ts';
import { MAINTENANCE_DATABASE, readDatabaseName, readServer, readSetting } from './settings.ts';

const env = process.env;
const testDatabase = readDatabaseName(env, 'TPS_TEST_DB_NAME');

async function connect(database: string, user?: LoginRole): Promise<pg.Client> {
  const client = new pg.Client({
    ...readServer(env),
    database,
    user: user ?? readSetting(env, 'TPS_DB_SUPERUSER'),
    password: user ? readRolePassword(env, user) : readSetting(env, 'TPS_DB_SUPERUSER_PASSWORD'),
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

  it('sets every function owner up with no login and no password, even after a change by hand', async () => {
    const role = 'owner_app_create_tenant';
    await withClient(MAINTENANCE_DATABASE, (client) =>
      client.query(`ALTER ROLE ${role} LOGIN BYPASSRLS PASSWORD 'a-password-set-by-hand'`),
    );
    let problems: string[];
    try {
      problems = await withClient(testDatabase, (client) => findRoleProblems(client));
    } finally {
      await withClient(MAINTENANCE_DATABASE, (client) => applyRoles(client, env));
    }
    expect(problems).toEqual([
      `role ${role} can log in`,
      `role ${role} bypasses row-level security`,
    ]);

    const { rows } = await withClient(MAINTENANCE_DATABASE, (client) =>
      client.query<{ rolname: string; rolcanlogin: boolean; rolpassword: string | null }>(
        `SELECT rolname, rolcanlogin, rolpassword FROM pg_catalog.pg_authid
          WHERE rolname = ANY($1::text[]) ORDER BY array_position($1::text[], rolname::text)`,
        [OWNER_ROLES],
      ),
    );
    expect(rows).toEqual(
      OWNER_ROLES.map((rolname) => ({ rolname, rolcanlogin: false, rolpassword: null })),
    );
    await expectRolesUnchanged();
  });

  it("reports any membership but migrator's SET-only one in each owner, and resets it", async () => {
    await withClient(MAINTENANCE_DATABASE, (client) =>
      client.query(
        `REVOKE owner_app_public_tenant FROM migrator;
         GRANT owner_auth_session_context TO migrator WITH INHERIT TRUE;
         GRANT owner_app_create_tenant TO app_api;`,
      ),
    );
    let problems: string[];
    try {
      problems = await withClient(testDatabase, (client) => findRoleProblems(client));
    } finally {
      await withClient(MAINTENANCE_DATABASE, (client) => applyRoles(client, env));
    }
    expect(problems).toEqual([
      'role migrator has a role membership the roles script does not grant',
      'role app_api has a role membership the roles script does not grant',
      'role owner_auth_session_context has a role membership the roles script does not grant',
      'migrator is not a SET-only member of role owner_auth_session_context',
      'migrator is not a SET-only member of role owner_app_public_tenant',
      'role owner_app_create_tenant has a role membership the roles script does not grant',
    ]);
    await expectRolesUnchanged();
  });

  it('lets a migration hand a function to its owner, and replace it as that owner, as ADR 0023 sets out', async () => {
    const owner = 'owner_auth_session_context';
    await withClient(
      testDatabase,
      async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            `CREATE SCHEMA owner_transfer;
             GRANT USAGE ON SCHEMA owner_transfer TO app_api;
             CREATE FUNCTION owner_transfer.answer() RETURNS integer LANGUAGE sql AS 'SELECT 1';
             GRANT EXECUTE ON FUNCTION owner_transfer.answer() TO app_api;
             SAVEPOINT without_create;`,
          );
          // The owner never holds CREATE on a schema beyond the transfer itself.
          await expect(
            client.query(`ALTER FUNCTION owner_transfer.answer() OWNER TO ${owner}`),
          ).rejects.toThrow('permission denied for schema owner_transfer');
          await client.query(
            `ROLLBACK TO SAVEPOINT without_create;
             GRANT CREATE ON SCHEMA owner_transfer TO ${owner};
             ALTER FUNCTION owner_transfer.answer() OWNER TO ${owner};
             SET LOCAL ROLE ${owner};
             CREATE OR REPLACE FUNCTION owner_transfer.answer() RETURNS integer LANGUAGE sql AS 'SELECT 2';
             RESET ROLE;
             REVOKE CREATE ON SCHEMA owner_transfer FROM ${owner};`,
          );
          const { rows } = await client.query(
            `SELECT p.proowner::regrole::text AS owner, p.prosrc AS source,
                    pg_catalog.has_schema_privilege($1, 'owner_transfer', 'CREATE') AS owner_can_create,
                    pg_catalog.pg_has_role('migrator', $1, 'USAGE') AS migrator_inherits,
                    pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS app_api_can_run
               FROM pg_catalog.pg_proc p
              WHERE p.oid = 'owner_transfer.answer()'::regprocedure`,
            [owner],
          );
          expect(rows).toEqual([
            {
              owner,
              source: 'SELECT 2',
              owner_can_create: false,
              migrator_inherits: false,
              app_api_can_run: true,
            },
          ]);
        } finally {
          await client.query('ROLLBACK');
        }
      },
      'migrator',
    );
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
