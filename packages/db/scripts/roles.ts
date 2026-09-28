// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs the two parts of the roles script (roles.sql and
// database-privileges.sql) and checks their result (ADR 0003).

import { readFileSync } from 'node:fs';

import type pg from 'pg';

import { scramSha256Verifier } from './scram.ts';
import { readSecret, type Env } from './settings.ts';

/** Bump together with the version in roles.sql and database-privileges.sql. */
export const ROLES_SCRIPT_VERSION = '1';

/** The login roles that roles.sql creates, in the order it creates them. */
export const LOGIN_ROLES = ['migrator', 'app_api', 'app_worker', 'app_auth', 'app_queue'] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

const ROLES_SQL = new URL('./roles.sql', import.meta.url);
const DATABASE_PRIVILEGES_SQL = new URL('./database-privileges.sql', import.meta.url);

const MINIMUM_PASSWORD_LENGTH = 16;

/** The fixed development passwords in infra/compose/compose.dev.yaml all end like this. */
const DEVELOPMENT_PASSWORD = /not-a-secret$/;

/** The environment variable that holds each role's password. */
export function passwordVariable(role: LoginRole): string {
  return `PIXELGRANT_DB_${role.toUpperCase()}_PASSWORD`;
}

/**
 * Read a role's password and check it may be used here: long enough, and a
 * known development password only when PIXELGRANT_DEV=1.
 */
export function readRolePassword(env: Env, role: LoginRole): string {
  const name = passwordVariable(role);
  const password = readSecret(env, name);
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`);
  }
  if (DEVELOPMENT_PASSWORD.test(password) && env['PIXELGRANT_DEV'] !== '1') {
    throw new Error(`${name} is a development password. Set a real one outside development.`);
  }
  return password;
}

/**
 * Keep this session's statements and their parameters out of the server log,
 * whatever the server's own logging settings. Only a superuser can set these.
 */
async function quietLogging(client: pg.ClientBase): Promise<void> {
  await client.query(
    "SET log_statement = 'none'; SET log_min_duration_statement = -1; " +
      'SET log_parameter_max_length = 0; SET log_parameter_max_length_on_error = 0',
  );
}

/**
 * Run roles.sql as a superuser, connected to the maintenance database, with
 * each role's password from the environment. On failure the caller must
 * close the connection.
 */
export async function applyRoles(client: pg.ClientBase, env: Env): Promise<void> {
  const verifiers = Object.fromEntries(
    LOGIN_ROLES.map((role) => [role, scramSha256Verifier(readRolePassword(env, role))]),
  ) as Record<LoginRole, string>;
  await applyRoleVerifiers(client, verifiers);
}

/**
 * Run roles.sql with the given SCRAM-SHA-256 verifiers. Each is sent as a
 * bound parameter into a session setting that the script clears, so neither
 * a password nor a verifier appears in SQL text.
 */
export async function applyRoleVerifiers(
  client: pg.ClientBase,
  verifiers: Readonly<Record<LoginRole, string>>,
): Promise<void> {
  await quietLogging(client);
  for (const role of LOGIN_ROLES) {
    await client.query('SELECT pg_catalog.set_config($1, $2, false)', [
      `pixelgrant.scram_verifier_${role}`,
      verifiers[role],
    ]);
  }
  // A query with no parameters uses the simple protocol, which runs the
  // whole file, including its own BEGIN and COMMIT.
  await client.query(readFileSync(ROLES_SQL, 'utf8'));
}

/** Run database-privileges.sql as a superuser, connected to a PixelGrant database. */
export async function applyDatabasePrivileges(client: pg.ClientBase): Promise<void> {
  await client.query(readFileSync(DATABASE_PRIVILEGES_SQL, 'utf8'));
}

interface RoleRow {
  rolname: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  version_comment: string | null;
  has_membership: boolean;
  has_settings: boolean;
}

interface DatabaseRow {
  owner: string;
  public_privileges: string[];
  connect_roles: string[];
}

/**
 * Return every way the roles, and the database this client is connected to,
 * differ from what the roles script sets up. Any role may run this: it reads
 * only catalogues that PUBLIC can read.
 */
export async function findRoleProblems(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<RoleRow>(
    `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb,
            r.rolreplication, r.rolbypassrls,
            pg_catalog.shobj_description(r.oid, 'pg_authid') AS version_comment,
            EXISTS (
              SELECT FROM pg_catalog.pg_auth_members m
              WHERE m.member = r.oid OR m.roleid = r.oid
            ) AS has_membership,
            EXISTS (
              SELECT FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid
            ) AS has_settings
       FROM pg_catalog.pg_roles r
      WHERE r.rolname = ANY($1::text[])`,
    [LOGIN_ROLES],
  );

  const problems: string[] = [];
  const expectedComment = `pixelgrant-roles-version=${ROLES_SCRIPT_VERSION}`;
  for (const role of LOGIN_ROLES) {
    const row = rows.find((candidate) => candidate.rolname === role);
    if (!row) {
      problems.push(`role ${role} does not exist`);
      continue;
    }
    if (row.version_comment !== expectedComment) {
      problems.push(`role ${role} was not set up by roles script version ${ROLES_SCRIPT_VERSION}`);
    }
    if (!row.rolcanlogin) problems.push(`role ${role} cannot log in`);
    if (row.rolsuper) problems.push(`role ${role} is a superuser`);
    if (row.rolbypassrls) problems.push(`role ${role} bypasses row-level security`);
    if (row.rolcreaterole) problems.push(`role ${role} can create roles`);
    if (row.rolcreatedb) problems.push(`role ${role} can create databases`);
    if (row.rolreplication) problems.push(`role ${role} can start replication`);
    if (row.has_membership) {
      problems.push(`role ${role} is a member of, or has members in, another role`);
    }
    if (row.has_settings) problems.push(`role ${role} has its own settings`);
  }

  const database = await client.query<DatabaseRow>(
    `SELECT d.datdba::regrole::text AS owner,
            array(SELECT a.privilege_type FROM pg_catalog.aclexplode(d.datacl) a
                   WHERE a.grantee = 0 ORDER BY 1) AS public_privileges,
            array(SELECT r.rolname::text FROM pg_catalog.aclexplode(d.datacl) a
                   JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
                   WHERE a.privilege_type = 'CONNECT' ORDER BY 1) AS connect_roles
       FROM pg_catalog.pg_database d
      WHERE d.datname = pg_catalog.current_database()`,
  );
  const row = database.rows[0];
  if (!row) {
    problems.push('the current database is missing from pg_database');
  } else {
    if (row.owner !== 'migrator') {
      problems.push(`the database is owned by ${row.owner}, not migrator`);
    }
    if (row.public_privileges.length > 0) {
      problems.push(`PUBLIC holds ${row.public_privileges.join(', ')} on the database`);
    }
    const missing = LOGIN_ROLES.filter((role) => !row.connect_roles.includes(role));
    if (missing.length > 0) {
      problems.push(`roles ${missing.join(', ')} cannot connect to the database`);
    }
  }
  return problems;
}

/** Throw unless the roles and this database match this version of the roles script. */
export async function assertRoles(client: pg.ClientBase): Promise<void> {
  const problems = await findRoleProblems(client);
  if (problems.length > 0) {
    throw new Error(
      [
        'The database roles do not match the roles script:',
        ...problems.map((problem) => `  - ${problem}`),
        'Run the roles script as a superuser (pnpm db:migrate does this in development).',
      ].join('\n'),
    );
  }
}
