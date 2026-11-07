// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The roles script against a real PostgreSQL server. These tests connect as
// the superuser, so they run in the db-admin Vitest project (`pnpm test:db`).
// They change only what the roles script itself sets, and leave the roles as
// the development environment expects them. Managed mode runs as a stand-in
// admin role with CREATEROLE and no SUPERUSER, in a database of its own.

import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFINER_FUNCTIONS } from '../test/catalogue/index.ts';
import { findPrivilegeProblems } from '../test/privilege-lint.ts';
import { EXCEPTED_SCHEMAS } from '../test/schema-lint.ts';
import {
  applyDatabasePrivileges,
  applyRoles,
  applyRoleVerifiers,
  assertRoles,
  BACKUP_ROLE,
  findObjectRightProblems,
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

/** The owners of the approved definer functions, from the catalogue. */
const USED_OWNERS: ReadonlySet<string> = new Set(
  [...DEFINER_FUNCTIONS.values()].map(({ owner }) => owner),
);

/** The owners created ahead for later tasks' functions, which own nothing yet. */
const UNUSED_OWNERS: readonly string[] = OWNER_ROLES.filter((role) => !USED_OWNERS.has(role));

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

function asSuperuser(database: string, sql: string): Promise<pg.QueryResult> {
  return withClient(database, (client) => client.query(sql));
}

function developmentVerifiers(): Record<LoginRole, string> {
  return Object.fromEntries(
    LOGIN_ROLES.map((role) => [role, scramSha256Verifier(readRolePassword(env, role))]),
  ) as Record<LoginRole, string>;
}

async function rejection(work: Promise<unknown>): Promise<Error> {
  let failure: unknown;
  try {
    await work;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  return failure as Error;
}

/** Run roles.sql with these verifiers and return the error it fails with. */
async function failureWith(
  verifiers: Record<LoginRole, string>,
  before?: string,
): Promise<pg.DatabaseError> {
  const client = await connect(MAINTENANCE_DATABASE);
  try {
    if (before) await client.query(before);
    return (await rejection(applyRoleVerifiers(client, verifiers))) as pg.DatabaseError;
  } finally {
    await client.end();
  }
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

/** Apply both parts of the roles script as the superuser, as `pnpm db:migrate` does. */
async function resetRoles(): Promise<void> {
  await withClient(MAINTENANCE_DATABASE, (client) => applyRoles(client, env));
  await withClient(testDatabase, (client) => applyDatabasePrivileges(client));
}

/**
 * ADR 0023: as migrator, a migration hands a function to its owner and
 * replaces it as that owner, and migrator never holds the owner's rights.
 */
async function expectOwnerHandover(database: string): Promise<void> {
  const owner = 'owner_auth_session_context';
  await withClient(
    database,
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
}

describe('roles.sql', () => {
  it('sets every role up so that it can log in with its password', async () => {
    await resetRoles();

    for (const role of LOGIN_ROLES) {
      const problems = await withClient(testDatabase, (client) => findRoleProblems(client), role);
      expect(problems).toEqual([]);
    }
    await withClient(testDatabase, (client) => assertRoles(client), 'migrator');
  });

  it('sets every function owner up with no login and no password, even after a change by hand', async () => {
    const role = 'owner_app_create_tenant';
    await asSuperuser(
      MAINTENANCE_DATABASE,
      `ALTER ROLE ${role} LOGIN BYPASSRLS PASSWORD 'a-password-set-by-hand';
       ALTER ROLE ${BACKUP_ROLE} NOBYPASSRLS;
       COMMENT ON ROLE app_queue IS 'tps-roles-version=3';`,
    );
    let problems: string[];
    try {
      problems = await withClient(testDatabase, (client) => findRoleProblems(client));
    } finally {
      await resetRoles();
    }
    expect(problems).toEqual([
      'role app_queue was not set up by roles script version 4',
      `role ${BACKUP_ROLE} does not bypass row-level security, so a backup would miss rows`,
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

  it('creates the owners of later functions owning nothing and holding no right anywhere', async () => {
    // Every definer owner the catalogue names is one roles.sql creates, so
    // the used and unused owners together are exactly OWNER_ROLES.
    const ownerRoles: readonly string[] = OWNER_ROLES;
    expect([...USED_OWNERS].filter((owner) => !ownerRoles.includes(owner))).toEqual([]);
    expect(USED_OWNERS.size + UNUSED_OWNERS.length).toBe(OWNER_ROLES.length);
    expect(USED_OWNERS.has('owner_app_tenant_ids')).toBe(true);
    expect(UNUSED_OWNERS).not.toContain('owner_app_tenant_ids');

    const { rows } = await withClient(MAINTENANCE_DATABASE, (client) =>
      client.query<{ rolname: string; deptype: string }>(
        `SELECT r.rolname, d.deptype
           FROM pg_catalog.pg_shdepend d
           JOIN pg_catalog.pg_roles r ON r.oid = d.refobjid
          WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
            AND r.rolname = ANY($1::text[])`,
        [UNUSED_OWNERS],
      ),
    );
    expect(rows).toEqual([]);
  });

  it("reports any membership but migrator's SET-only one in each owner, and resets it", async () => {
    await asSuperuser(
      MAINTENANCE_DATABASE,
      `REVOKE owner_app_public_tenant FROM migrator;
       GRANT owner_auth_session_context TO migrator WITH INHERIT TRUE;
       GRANT owner_app_create_tenant TO app_api;
       GRANT ${BACKUP_ROLE} TO app_worker;`,
    );
    let problems: string[];
    try {
      problems = await withClient(testDatabase, (client) => findRoleProblems(client));
    } finally {
      await resetRoles();
    }
    expect(problems).toEqual([
      'migrator is not a SET-only member of role owner_auth_session_context',
      'migrator is not a SET-only member of role owner_app_public_tenant',
      'role app_api is a member of role owner_app_create_tenant with INHERIT, SET, which the roles script does not grant',
      `role app_worker is a member of role ${BACKUP_ROLE} with INHERIT, SET, which the roles script does not grant`,
      'role migrator is a member of role owner_auth_session_context with INHERIT, SET, which the roles script does not grant',
    ]);
    await expectRolesUnchanged();
  });

  it('lets a migration hand a function to its owner, and replace it as that owner, as ADR 0023 sets out', async () => {
    await expectOwnerHandover(testDatabase);
  });

  it('never repeats a password verifier in its errors', async () => {
    const verifiers = developmentVerifiers();
    // passwordcheck refuses a password equal to the role name, which makes
    // the password statement for backup_reader, the last role, fail.
    verifiers.backup_reader = scramSha256Verifier('backup_reader');
    const secretParts = verifiers.backup_reader.split(/[$:]/).slice(2);

    const error = await failureWith(verifiers, "LOAD 'passwordcheck'");

    expect(error.message).toBe(
      'Could not set the password for role backup_reader (SQLSTATE 22023).',
    );
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

describe('database-privileges.sql', () => {
  it('lets the backup role read every table and change none, and reports otherwise', async () => {
    const problems = await withClient(testDatabase, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `GRANT INSERT ON app.tenant TO ${BACKUP_ROLE};
           GRANT UPDATE (diff) ON app.config_version TO ${BACKUP_ROLE};
           REVOKE SELECT ON app.audit_event FROM ${BACKUP_ROLE};
           GRANT EXECUTE ON FUNCTION auth.session_context(bytea) TO ${BACKUP_ROLE};
           GRANT CREATE ON SCHEMA app TO PUBLIC;
           GRANT CREATE ON SCHEMA ext TO ${BACKUP_ROLE};
           GRANT TEMPORARY ON DATABASE ${client.escapeIdentifier(testDatabase)} TO ${BACKUP_ROLE};
           CREATE SEQUENCE app.backup_owned;
           ALTER SEQUENCE app.backup_owned OWNER TO ${BACKUP_ROLE};
           ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE SELECT ON TABLES FROM ${BACKUP_ROLE};
           ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA app
             GRANT UPDATE ON SEQUENCES TO ${BACKUP_ROLE};`,
        );
        return await findObjectRightProblems(client);
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(problems).toEqual([
      'PUBLIC holds CREATE on schema app',
      `role ${BACKUP_ROLE} can change app.backup_owned`,
      `role ${BACKUP_ROLE} can change app.config_version`,
      `role ${BACKUP_ROLE} can change app.tenant`,
      `role ${BACKUP_ROLE} can execute the definer function auth.session_context(bytea)`,
      `role ${BACKUP_ROLE} cannot read app.audit_event`,
      `role ${BACKUP_ROLE} gets UPDATE on new sequences that migrator creates in schema app`,
      `role ${BACKUP_ROLE} gets no SELECT on new tables that migrator creates`,
      `role ${BACKUP_ROLE} holds CREATE on schema app`,
      `role ${BACKUP_ROLE} holds CREATE on schema ext`,
      `role ${BACKUP_ROLE} holds CREATE or TEMPORARY on the database`,
      `role ${BACKUP_ROLE} owns sequence app.backup_owned`,
    ]);
    await withClient(testDatabase, (client) => assertRoles(client));
  });

  it('lets the backup role read the schemas, tables and sequences that a later migration creates', async () => {
    const { problems, rights } = await withClient(
      testDatabase,
      async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            `CREATE SCHEMA later;
             CREATE TABLE later.note (id integer GENERATED ALWAYS AS IDENTITY, body text);
             CREATE TABLE app.later_note (body text);`,
          );
          const { rows } = await client.query(
            `SELECT pg_catalog.has_schema_privilege($1, 'later', 'USAGE') AS schema,
                    pg_catalog.has_table_privilege($1, 'later.note', 'SELECT') AS table,
                    pg_catalog.has_sequence_privilege($1, 'later.note_id_seq', 'SELECT') AS sequence,
                    pg_catalog.has_table_privilege($1, 'app.later_note', 'SELECT') AS app_table`,
            [BACKUP_ROLE],
          );
          return { problems: await findObjectRightProblems(client), rights: rows };
        } finally {
          await client.query('ROLLBACK');
        }
      },
      'migrator',
    );
    expect(rights).toEqual([{ schema: true, table: true, sequence: true, app_table: true }]);
    expect(problems).toEqual([]);
  });

  it('lets no other role use the backup role', async () => {
    await withClient(
      testDatabase,
      async (client) => {
        await expect(client.query(`SET ROLE ${BACKUP_ROLE}`)).rejects.toThrow(
          `permission denied to set role "${BACKUP_ROLE}"`,
        );
      },
      'app_api',
    );
    const { rows } = await asSuperuser(
      testDatabase,
      `SELECT r.rolname FROM pg_catalog.pg_roles r
        WHERE r.rolname <> '${BACKUP_ROLE}' AND pg_catalog.pg_has_role(r.oid, '${BACKUP_ROLE}', 'MEMBER')
          AND NOT r.rolsuper`,
    );
    expect(rows).toEqual([]);
  });

  it('installs pg_trgm in schema ext, which only migrator, app_api and app_worker may use', async () => {
    const { rows } = await asSuperuser(
      testDatabase,
      `SELECT x.extnamespace::regnamespace::text AS schema,
              array(SELECT r.name FROM unnest(ARRAY['public', 'migrator', 'app_api', 'app_worker',
                                                    'app_auth', 'app_queue', '${BACKUP_ROLE}']) AS r(name)
                     WHERE pg_catalog.has_schema_privilege(r.name, 'ext', 'USAGE')) AS users,
              (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'ext'::regnamespace
                  AND (pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
                       OR pg_catalog.has_function_privilege('app_auth', p.oid, 'EXECUTE')
                       OR NOT pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE')
                       OR NOT pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE')))::integer
                AS wrong_functions,
              (SELECT count(*) FROM pg_catalog.pg_proc p
                WHERE p.pronamespace = 'ext'::regnamespace)::integer > 0 AS has_functions
         FROM pg_catalog.pg_extension x WHERE x.extname = 'pg_trgm'`,
    );
    expect(rows).toEqual([
      {
        schema: 'ext',
        users: ['migrator', 'app_api', 'app_worker'],
        wrong_functions: 0,
        has_functions: true,
      },
    ]);

    // migrator builds a trigram index with USAGE alone (S12-04).
    await withClient(
      testDatabase,
      async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            `CREATE TABLE app.trigram_check (name text);
             CREATE INDEX ON app.trigram_check USING gin (name ext.gin_trgm_ops);`,
          );
        } finally {
          await client.query('ROLLBACK');
        }
      },
      'migrator',
    );
  });

  // Only the schema's owner can make these changes, so the privilege lint's
  // checks of schema ext are tested here, as the superuser.
  it('leaves schema ext to the privilege lint, which reports anything else in it and any other use', async () => {
    const { owner, problems } = await withClient(testDatabase, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `GRANT USAGE ON SCHEMA ext TO app_auth;
           GRANT CREATE ON SCHEMA ext TO app_worker;
           CREATE FUNCTION ext.lint_extra() RETURNS integer LANGUAGE sql RETURN 1;
           REVOKE EXECUTE ON FUNCTION ext.lint_extra() FROM PUBLIC;`,
        );
        const { rows } = await client.query<{ owner: string }>(
          "SELECT nspowner::regrole::text AS owner FROM pg_catalog.pg_namespace WHERE nspname = 'ext'",
        );
        return {
          owner: rows[0]?.owner ?? '',
          problems: await findPrivilegeProblems(client, [...EXCEPTED_SCHEMAS.keys()]),
        };
      } finally {
        await client.query('ROLLBACK');
      }
    });
    const users = (...roles: string[]) => [owner, ...roles].sort().join(', ');
    expect(owner).toBe(readSetting(env, 'TPS_DB_SUPERUSER'));
    expect(problems.sort()).toEqual(
      [
        'function ext.lint_extra() is in schema ext but not part of pg_trgm.',
        'app_api cannot execute ext.lint_extra().',
        'app_worker cannot execute ext.lint_extra().',
        `USAGE on schema ext is held by ${users('app_api', 'app_auth', 'app_worker', 'migrator')}, not ${users('app_api', 'app_worker', 'migrator')}.`,
        'app_worker holds CREATE on schema ext, which only its owner may.',
        'Role app_worker can create objects in schema ext.',
        'Role app_auth holds USAGE on schema ext, outside its own schema auth.',
      ].sort(),
    );
  });
});

describe('managed mode', () => {
  const admin = `${testDatabase}_admin`;
  const adminPassword = randomBytes(24).toString('base64url');
  const database = `${testDatabase}_managed`;
  const managed = { ...env, TPS_DB_ADMIN_MODE: 'managed' };

  async function asAdmin<T>(name: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({
      ...readServer(env),
      database: name,
      user: admin,
      password: adminPassword,
    });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  function runManaged(): Promise<void> {
    return asAdmin(MAINTENANCE_DATABASE, (client) => applyRoles(client, managed));
  }

  function runManagedPrivileges(): Promise<void> {
    return asAdmin(database, (client) => applyDatabasePrivileges(client, 'managed'));
  }

  beforeAll(async () => {
    await resetRoles();
    await asSuperuser(
      MAINTENANCE_DATABASE,
      `CREATE ROLE ${admin} LOGIN CREATEROLE CREATEDB BYPASSRLS
         PASSWORD '${scramSha256Verifier(adminPassword)}'`,
    );
    await asSuperuser(MAINTENANCE_DATABASE, `CREATE DATABASE ${database} OWNER migrator`);
    // A table that forces row-level security, holding rows of two tenants.
    await withClient(
      database,
      (client) =>
        client.query(
          `CREATE SCHEMA backup_check;
           CREATE TABLE backup_check.note (tenant_id integer NOT NULL, body text NOT NULL);
           INSERT INTO backup_check.note VALUES (1, 'first tenant'), (2, 'second tenant');
           ALTER TABLE backup_check.note ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
           CREATE POLICY tenant ON backup_check.note
             USING (tenant_id = pg_catalog.current_setting('app.tenant', true)::integer);`,
        ),
      'migrator',
    );
  });

  // As if the admin role had created every role: PostgreSQL then grants it
  // ADMIN OPTION alone on each, from the bootstrap superuser.
  beforeEach(async () => {
    await asSuperuser(
      MAINTENANCE_DATABASE,
      [...LOGIN_ROLES, ...OWNER_ROLES]
        .map((role) => `GRANT ${role} TO ${admin} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;`)
        .join('\n'),
    );
  });

  afterAll(async () => {
    try {
      await asSuperuser(MAINTENANCE_DATABASE, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await resetRoles();
    } finally {
      await asSuperuser(MAINTENANCE_DATABASE, `DROP ROLE IF EXISTS ${admin}`);
    }
  });

  it('runs as an admin role with CREATEROLE and no SUPERUSER, and checks the result', async () => {
    // A membership the admin role gave itself is revoked.
    await asAdmin(MAINTENANCE_DATABASE, (client) =>
      client.query(`GRANT app_api TO ${admin} WITH INHERIT TRUE, SET TRUE`),
    );
    await runManaged();
    await runManagedPrivileges();

    const { rows } = await asSuperuser(
      MAINTENANCE_DATABASE,
      `SELECT m.admin_option, m.inherit_option, m.set_option, m.grantor::regrole::text AS grantor,
              count(*)::integer AS roles
         FROM pg_catalog.pg_auth_members m
        WHERE m.member = '${admin}'::regrole
        GROUP BY 1, 2, 3, 4`,
    );
    expect(rows).toEqual([
      {
        admin_option: true,
        inherit_option: false,
        set_option: false,
        grantor: readSetting(env, 'TPS_DB_SUPERUSER'),
        roles: LOGIN_ROLES.length + OWNER_ROLES.length,
      },
    ]);
    await withClient(database, (client) => assertRoles(client, admin), 'migrator');
  });

  it('allows the creator grant to the admin role alone, and only in managed mode', async () => {
    const other = `${testDatabase}_other_admin`;
    await asSuperuser(
      MAINTENANCE_DATABASE,
      `CREATE ROLE ${other} CREATEROLE;
       GRANT ${BACKUP_ROLE} TO ${other} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;`,
    );
    let managedProblems: string[];
    let superuserProblems: string[];
    try {
      managedProblems = await withClient(database, (client) => findRoleProblems(client, admin));
      superuserProblems = await withClient(database, (client) => findRoleProblems(client));
    } finally {
      await asSuperuser(MAINTENANCE_DATABASE, `DROP ROLE ${other}`);
    }
    const adminOnly = (member: string, role: string) =>
      `role ${member} is a member of role ${role} with ADMIN, which the roles script does not grant`;
    expect(managedProblems).toEqual([adminOnly(other, BACKUP_ROLE)]);
    expect(superuserProblems).toEqual([
      ...[...LOGIN_ROLES, ...OWNER_ROLES].sort().map((role) => adminOnly(admin, role)),
      adminOnly(other, BACKUP_ROLE),
    ]);
  });

  it('lets a migration hand a function to its owner, as ADR 0023 sets out', async () => {
    await expectOwnerHandover(database);
  });

  it('lets the backup role read a forced row-level security table across tenants, and not write', async () => {
    await withClient(
      database,
      async (client) => {
        // pg_dump turns row security off, and fails on a table it would filter.
        await client.query('SET row_security = off');
        const { rows } = await client.query(
          'SELECT tenant_id FROM backup_check.note ORDER BY tenant_id',
        );
        expect(rows).toEqual([{ tenant_id: 1 }, { tenant_id: 2 }]);
        await expect(
          client.query("INSERT INTO backup_check.note VALUES (3, 'third tenant')"),
        ).rejects.toThrow('permission denied for table note');
      },
      BACKUP_ROLE,
    );
    const visible = await withClient(
      database,
      (client) => client.query('SELECT count(*)::integer AS rows FROM backup_check.note'),
      'migrator',
    );
    expect(visible.rows).toEqual([{ rows: 0 }]);
  });

  it('reports everything it cannot change, and fails', async () => {
    await asSuperuser(
      MAINTENANCE_DATABASE,
      `ALTER ROLE app_worker REPLICATION;
       ALTER ROLE app_auth CREATEDB;
       ALTER ROLE app_api SET log_min_messages = 'debug1';
       GRANT owner_app_create_tenant TO app_api;
       GRANT pg_monitor TO app_queue;`,
    );
    await asSuperuser(
      database,
      `CREATE SCHEMA hand_made;
       GRANT CREATE ON SCHEMA hand_made TO PUBLIC;
       CREATE FUNCTION hand_made.answer() RETURNS integer LANGUAGE sql RETURN 1;
       GRANT CREATE ON SCHEMA backup_check TO ${BACKUP_ROLE};
       GRANT UPDATE (body) ON backup_check.note TO ${BACKUP_ROLE};`,
    );
    let error: Error;
    try {
      await runManaged();
      error = await rejection(runManagedPrivileges());
    } finally {
      await asSuperuser(
        database,
        `DROP SCHEMA hand_made CASCADE;
         REVOKE CREATE ON SCHEMA backup_check FROM ${BACKUP_ROLE};
         REVOKE UPDATE (body) ON backup_check.note FROM ${BACKUP_ROLE};`,
      );
      await resetRoles();
    }
    expect(error.message.split('\n')).toEqual([
      'The database roles do not match the roles script:',
      '  - role app_api has its own settings',
      '  - role app_worker can start replication',
      '  - role app_api is a member of role owner_app_create_tenant with INHERIT, SET, which the roles script does not grant',
      '  - role app_queue is a member of role pg_monitor with INHERIT, SET, which the roles script does not grant',
      '  - PUBLIC can execute hand_made.answer()',
      '  - PUBLIC holds CREATE on schema hand_made',
      `  - role ${BACKUP_ROLE} can change backup_check.note`,
      `  - role ${BACKUP_ROLE} cannot use schema hand_made`,
      `  - role ${BACKUP_ROLE} holds CREATE on schema backup_check`,
      `  - role ${BACKUP_ROLE} holds CREATE on schema hand_made`,
      'Run the roles script (pnpm db:migrate does this in development), and fix by hand anything it reports that its role cannot change.',
    ]);
  });

  it('refuses to start on a role it may not change', async () => {
    await asSuperuser(
      MAINTENANCE_DATABASE,
      `ALTER ROLE owner_app_erase_notes SUPERUSER;
       REVOKE owner_app_erase_documents FROM ${admin} CASCADE;`,
    );
    let error: Error;
    try {
      error = await rejection(runManaged());
    } finally {
      await resetRoles();
    }
    expect(error.message).toBe(
      `Role ${admin} cannot change roles owner_app_erase_documents, owner_app_erase_notes: each is a superuser, or ${admin} has no ADMIN OPTION on it.`,
    );
  });

  it('fails closed when the admin role cannot give the backup role BYPASSRLS', async () => {
    await asSuperuser(MAINTENANCE_DATABASE, `ALTER ROLE ${admin} NOBYPASSRLS`);
    let error: Error;
    try {
      error = await rejection(runManaged());
    } finally {
      await asSuperuser(MAINTENANCE_DATABASE, `ALTER ROLE ${admin} BYPASSRLS`);
    }
    expect(error.message).toBe(
      `Role ${BACKUP_ROLE} needs BYPASSRLS so that pg_dump reads every row, and role ${admin} cannot grant it without BYPASSRLS itself.`,
    );
  });
});
