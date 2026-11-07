// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs the two parts of the roles script (roles.sql and
// database-privileges.sql) and checks their result (ADR 0003).

import { readFileSync } from 'node:fs';

import type pg from 'pg';

import { scramSha256Verifier } from './scram.ts';
import { isLocalDevelopment, readSecret, readSetting, type Env } from './settings.ts';

/** Bump together with the version in roles.sql and database-privileges.sql. */
export const ROLES_SCRIPT_VERSION = '4';

/** The login roles that roles.sql creates, in the order it creates them. */
export const LOGIN_ROLES = [
  'migrator',
  'app_api',
  'app_worker',
  'app_auth',
  'app_queue',
  'backup_reader',
] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

/**
 * The one role that bypasses row-level security, so that pg_dump reads every
 * row (ADR 0011). It holds SELECT and nothing else, belongs to no role, and
 * no role belongs to it. Nothing but the backup job connects as it.
 */
export const BACKUP_ROLE = 'backup_reader' satisfies LoginRole;

/**
 * The NOLOGIN owner of each approved definer function (ADRs 0003 and 0019),
 * in the order roles.sql creates them after the login roles. migrator is a
 * member of each with SET but not INHERIT, and that is the only membership
 * any of these roles holds (ADR 0023).
 */
export const OWNER_ROLES = [
  'owner_auth_session_context',
  'owner_auth_session_memberships',
  'owner_app_public_tenant',
  'owner_app_public_tenant_logo',
  'owner_app_create_tenant',
  'owner_app_tenant_ids',
  'owner_auth_sso_providers_by_key_version',
  'owner_app_purge_expired_audit',
  'owner_app_apply_retention',
  'owner_party_erase_party',
  'owner_grants_clear_answer_fields',
  'owner_app_destroy_subject_key',
  'owner_app_reapply_erasure_ledger',
  'owner_app_erase_notes',
  'owner_assure_erase_subject',
  'owner_privacy_erase_subject',
  'owner_grants_erase_reminders',
  'owner_crm_erase_subject',
  'owner_forms_submit_public_response',
  'owner_forms_erase_subject',
  'owner_grants_public_open_rounds',
  'owner_app_embed_origins',
  'owner_party_record_unsubscribe',
  'owner_app_resolve_signature_callback',
  'owner_app_erase_documents',
] as const;

/**
 * How the roles script connects, from TPS_DB_ADMIN_MODE: as a true
 * superuser (the default), or as a managed database's admin role, which has
 * CREATEROLE but is not a superuser, in which case the result is checked.
 */
export type AdminMode = 'superuser' | 'managed';

export function readAdminMode(env: Env): AdminMode {
  const mode = env['TPS_DB_ADMIN_MODE'] || 'superuser';
  if (mode !== 'superuser' && mode !== 'managed') {
    throw new Error('TPS_DB_ADMIN_MODE must be superuser or managed.');
  }
  return mode;
}

/**
 * In managed mode, the admin role the roles script runs as
 * (TPS_DB_SUPERUSER), whose creator grants the role checks allow; in
 * superuser mode, none. The migrate job passes this to assertRoles().
 */
export function readAdminRole(env: Env): string | undefined {
  return readAdminMode(env) === 'managed' ? readSetting(env, 'TPS_DB_SUPERUSER') : undefined;
}

const ALL_ROLES: readonly string[] = [...LOGIN_ROLES, ...OWNER_ROLES];

const ROLES_SQL = new URL('./roles.sql', import.meta.url);
const DATABASE_PRIVILEGES_SQL = new URL('./database-privileges.sql', import.meta.url);

const MINIMUM_PASSWORD_LENGTH = 16;

/** The fixed development passwords in infra/compose/compose.dev.yaml all end like this. */
const DEVELOPMENT_PASSWORD = /not-a-secret$/;

/** The environment variable that holds each role's password. */
export function passwordVariable(role: LoginRole): string {
  return `TPS_DB_${role.toUpperCase()}_PASSWORD`;
}

/**
 * Read a role's password and check it may be used here: long enough, and a
 * known development password only in development (TPS_DEV=1) against
 * a server on this machine, so it can never be set on a shared server.
 */
export function readRolePassword(env: Env, role: LoginRole): string {
  const name = passwordVariable(role);
  const password = readSecret(env, name);
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`);
  }
  if (DEVELOPMENT_PASSWORD.test(password) && !isLocalDevelopment(env)) {
    throw new Error(
      `${name} is a development password, which works only in development against a server on this machine. Set a real one.`,
    );
  }
  return password;
}

const QUIET_LOGGING: Readonly<Record<string, string>> = {
  log_statement: 'none',
  log_min_duration_statement: '-1',
  log_min_duration_sample: '-1',
  log_transaction_sample_rate: '0',
  log_min_error_statement: 'panic',
  log_parameter_max_length: '0',
  log_parameter_max_length_on_error: '0',
};

/**
 * Keep this session's statements and their parameters out of the server log.
 * A superuser sets that for its session, whatever the server's own settings.
 * A managed database's admin role may not, so the server's own settings must
 * already keep the parameters, which carry the verifiers, out of the log.
 */
async function quietLogging(client: pg.ClientBase, mode: AdminMode): Promise<void> {
  if (mode === 'superuser') {
    await client.query(
      Object.entries(QUIET_LOGGING)
        .map(([name, value]) => `SET ${name} = '${value}'`)
        .join('; '),
    );
    return;
  }
  const { rows } = await client.query<{ name: string; setting: string }>(
    'SELECT name, setting FROM pg_catalog.pg_settings WHERE name = ANY($1::text[])',
    [Object.keys(QUIET_LOGGING)],
  );
  const server = Object.fromEntries(rows.map((row) => [row.name, row.setting]));
  const statements =
    server['log_parameter_max_length'] === '0' ||
    (server['log_statement'] !== 'all' &&
      server['log_min_duration_statement'] === '-1' &&
      server['log_min_duration_sample'] === '-1' &&
      Number(server['log_transaction_sample_rate']) === 0);
  const errors =
    server['log_parameter_max_length_on_error'] === '0' ||
    server['log_min_error_statement'] === 'panic';
  if (!statements || !errors) {
    throw new Error(
      "The server's log settings would log the password verifiers the roles script sends. " +
        'Set log_parameter_max_length and log_parameter_max_length_on_error to 0.',
    );
  }
}

/**
 * Run roles.sql, connected to the maintenance database, in the mode the
 * environment sets, with each role's password from the environment. On
 * failure the caller must close the connection. In managed mode,
 * applyDatabasePrivileges() then checks the result.
 */
export async function applyRoles(client: pg.ClientBase, env: Env): Promise<void> {
  const mode = readAdminMode(env);
  const verifiers = Object.fromEntries(
    LOGIN_ROLES.map((role) => [role, scramSha256Verifier(readRolePassword(env, role))]),
  ) as Record<LoginRole, string>;
  await applyRoleVerifiers(client, verifiers, mode);
}

/**
 * Run roles.sql with the given SCRAM-SHA-256 verifiers. Each is sent as a
 * bound parameter into a session setting that the script clears, so neither
 * a password nor a verifier appears in SQL text.
 */
export async function applyRoleVerifiers(
  client: pg.ClientBase,
  verifiers: Readonly<Record<LoginRole, string>>,
  mode: AdminMode = 'superuser',
): Promise<void> {
  await quietLogging(client, mode);
  await setAdminMode(client, mode);
  for (const role of LOGIN_ROLES) {
    await client.query('SELECT pg_catalog.set_config($1, $2, false)', [
      `tps.scram_verifier_${role}`,
      verifiers[role],
    ]);
  }
  // A query with no parameters uses the simple protocol, which runs the
  // whole file, including its own BEGIN and COMMIT.
  await client.query(readFileSync(ROLES_SQL, 'utf8'));
}

/**
 * Run database-privileges.sql, connected to a Fairfold Grants database, in
 * the same mode as roles.sql. In managed mode, then check every role and
 * this database, and throw if anything differs.
 */
export async function applyDatabasePrivileges(
  client: pg.ClientBase,
  mode: AdminMode = 'superuser',
): Promise<void> {
  await setAdminMode(client, mode);
  await client.query(readFileSync(DATABASE_PRIVILEGES_SQL, 'utf8'));
  if (mode === 'managed') {
    const { rows } = await client.query<{ admin: string }>('SELECT current_user AS admin');
    await assertRoles(client, rows[0]?.admin);
  }
}

async function setAdminMode(client: pg.ClientBase, mode: AdminMode): Promise<void> {
  await client.query("SELECT pg_catalog.set_config('tps.admin_mode', $1, false)", [mode]);
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
  migrator_can_set: boolean;
  has_settings: boolean;
}

interface MembershipRow {
  member: string;
  granted: string;
  admin_option: boolean;
  inherit_option: boolean;
  set_option: boolean;
}

interface DatabaseRow {
  owner: string;
  public_privileges: string[];
  connect_roles: string[];
}

/**
 * Return every way the roles, and the database this client is connected to,
 * differ from what the roles script sets up. Any role may run this: it reads
 * only catalogues that PUBLIC can read. In managed mode, `admin` names the
 * admin role that ran the roles script (readAdminRole()).
 */
export async function findRoleProblems(client: pg.ClientBase, admin?: string): Promise<string[]> {
  const { rows } = await client.query<RoleRow>(
    `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb,
            r.rolreplication, r.rolbypassrls,
            pg_catalog.shobj_description(r.oid, 'pg_authid') AS version_comment,
            EXISTS (
              SELECT FROM pg_catalog.pg_auth_members m
              JOIN pg_catalog.pg_roles grantee ON grantee.oid = m.member
              WHERE m.roleid = r.oid AND grantee.rolname = 'migrator'
                AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option
            ) AS migrator_can_set,
            EXISTS (
              SELECT FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid
            ) AS has_settings
       FROM pg_catalog.pg_roles r
      WHERE r.rolname = ANY($1::text[])`,
    [ALL_ROLES],
  );

  const problems: string[] = [];
  const expectedComment = `tps-roles-version=${ROLES_SCRIPT_VERSION}`;
  for (const role of ALL_ROLES) {
    const row = rows.find((candidate) => candidate.rolname === role);
    if (!row) {
      problems.push(`role ${role} does not exist`);
      continue;
    }
    if (row.version_comment !== expectedComment) {
      problems.push(`role ${role} was not set up by roles script version ${ROLES_SCRIPT_VERSION}`);
    }
    const login = (LOGIN_ROLES as readonly string[]).includes(role);
    if (login && !row.rolcanlogin) problems.push(`role ${role} cannot log in`);
    if (!login && row.rolcanlogin) problems.push(`role ${role} can log in`);
    if (row.rolsuper) problems.push(`role ${role} is a superuser`);
    if (row.rolbypassrls && role !== BACKUP_ROLE) {
      problems.push(`role ${role} bypasses row-level security`);
    }
    if (!row.rolbypassrls && role === BACKUP_ROLE) {
      problems.push(`role ${role} does not bypass row-level security, so a backup would miss rows`);
    }
    if (row.rolcreaterole) problems.push(`role ${role} can create roles`);
    if (row.rolcreatedb) problems.push(`role ${role} can create databases`);
    if (row.rolreplication) problems.push(`role ${role} can start replication`);
    if (!login && !row.migrator_can_set) {
      problems.push(`migrator is not a SET-only member of role ${role}`);
    }
    if (row.has_settings) problems.push(`role ${role} has its own settings`);
  }

  // Every membership but migrator's SET-only ones in the owners and, in
  // managed mode, the ADMIN OPTION alone that PostgreSQL gives the admin role
  // on each role it creates, recorded as granted by the bootstrap superuser.
  const memberships = await client.query<MembershipRow>(
    `SELECT member.rolname AS member, granted.rolname AS granted,
            m.admin_option, m.inherit_option, m.set_option
       FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
       JOIN pg_catalog.pg_roles member ON member.oid = m.member
      WHERE (member.rolname = ANY($1::text[]) OR granted.rolname = ANY($1::text[]))
        AND NOT (member.rolname = 'migrator' AND granted.rolname = ANY($2::text[])
                 AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option)
        AND NOT (member.rolname IS NOT DISTINCT FROM $3::text
                 AND member.rolname <> ALL($1::text[])
                 AND m.grantor = 10::pg_catalog.oid
                 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
      ORDER BY 1, 2`,
    [ALL_ROLES, OWNER_ROLES, admin ?? null],
  );
  for (const m of memberships.rows) {
    const options = [
      m.admin_option && 'ADMIN',
      m.inherit_option && 'INHERIT',
      m.set_option && 'SET',
    ]
      .filter(Boolean)
      .join(', ');
    problems.push(
      `role ${m.member} is a member of role ${m.granted} with ${options || 'no options'}, which the roles script does not grant`,
    );
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

/**
 * Rights in this database that database-privileges.sql sets on objects:
 * PUBLIC holds no CREATE on a schema and no EXECUTE on a routine, outside
 * pg_trgm's schema ext (ADR 0025), and the backup role can read every
 * table and sequence, change none, even by column, create nothing, own
 * nothing, and execute no definer function. Default privileges give the
 * backup role USAGE on the schemas and SELECT on the tables and sequences
 * that migrator creates later, and nothing else.
 */
export async function findObjectRightProblems(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ problem: string }>(
    `WITH n AS (
       SELECT oid, nspname FROM pg_catalog.pg_namespace
        WHERE NOT pg_catalog.starts_with(nspname, 'pg_') AND nspname <> 'information_schema'
     ),
     kinds (kind, objects, privilege) AS (
       VALUES ('n'::"char", 'schemas', 'USAGE'), ('r', 'tables', 'SELECT'),
              ('S', 'sequences', 'SELECT'), ('f', 'functions', NULL), ('T', 'types', NULL)
     ),
     defaults AS (
       SELECT d.defaclrole::pg_catalog.regrole::text AS creator, d.defaclnamespace AS schema,
              d.defaclobjtype AS kind, a.privilege_type AS privilege
         FROM pg_catalog.pg_default_acl d
        CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
        WHERE a.grantee = $1::pg_catalog.regrole
     )
     SELECT pg_catalog.format('PUBLIC holds CREATE on schema %s', n.nspname) AS problem
       FROM n WHERE pg_catalog.has_schema_privilege('public', n.oid, 'CREATE')
     UNION ALL
     SELECT pg_catalog.format('PUBLIC can execute %s', p.oid::pg_catalog.regprocedure)
       FROM pg_catalog.pg_proc p JOIN n ON n.oid = p.pronamespace
      WHERE n.nspname <> 'ext' AND pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
     UNION ALL
     SELECT pg_catalog.format('role %s cannot use schema %s', $1::text, n.nspname)
       FROM n WHERE n.nspname <> 'ext' AND NOT pg_catalog.has_schema_privilege($1, n.oid, 'USAGE')
     UNION ALL
     SELECT pg_catalog.format('role %s cannot read %s.%s', $1::text, n.nspname, c.relname)
       FROM pg_catalog.pg_class c JOIN n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'S') AND NOT pg_catalog.has_table_privilege($1, c.oid, 'SELECT')
     UNION ALL
     SELECT pg_catalog.format('role %s can change %s.%s', $1::text, n.nspname, c.relname)
       FROM pg_catalog.pg_class c JOIN n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND (pg_catalog.has_table_privilege($1, c.oid,
               'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
             OR pg_catalog.has_any_column_privilege($1, c.oid, 'INSERT, UPDATE, REFERENCES'))
     UNION ALL
     SELECT pg_catalog.format('role %s holds CREATE on schema %s', $1::text, n.nspname)
       FROM n WHERE pg_catalog.has_schema_privilege($1, n.oid, 'CREATE')
     UNION ALL
     SELECT pg_catalog.format('role %s holds CREATE or TEMPORARY on the database', $1::text)
      WHERE pg_catalog.has_database_privilege($1, pg_catalog.current_database(), 'CREATE, TEMPORARY')
     UNION ALL
     SELECT pg_catalog.format('role %s owns %s', $1::text,
                              pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid))
       FROM pg_catalog.pg_shdepend d
      WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
        AND d.refobjid = $1::pg_catalog.regrole AND d.deptype = 'o'
        AND d.dbid IN (0, (SELECT oid FROM pg_catalog.pg_database
                            WHERE datname = pg_catalog.current_database()))
     UNION ALL
     SELECT pg_catalog.format('role %s can execute the definer function %s',
                              $1::text, p.oid::pg_catalog.regprocedure)
       FROM pg_catalog.pg_proc p JOIN n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND pg_catalog.has_function_privilege($1, p.oid, 'EXECUTE')
     UNION ALL
     SELECT pg_catalog.format('role %s gets no %s on new %s that migrator creates',
                              $1::text, k.privilege, k.objects)
       FROM kinds k
      WHERE k.privilege IS NOT NULL
        AND NOT EXISTS (SELECT FROM defaults d
                         WHERE d.creator = 'migrator' AND d.schema = 0
                           AND d.kind = k.kind AND d.privilege = k.privilege)
     UNION ALL
     SELECT pg_catalog.format('role %s gets %s on new %s that %s creates%s', $1::text,
                              d.privilege, COALESCE(k.objects, d.kind::text), d.creator,
                              CASE WHEN d.schema <> 0
                                THEN ' in schema ' || d.schema::pg_catalog.regnamespace::text END)
       FROM defaults d LEFT JOIN kinds k ON k.kind = d.kind
      WHERE d.creator <> 'migrator' OR d.schema <> 0 OR d.privilege IS DISTINCT FROM k.privilege
      ORDER BY 1`,
    [BACKUP_ROLE],
  );
  return rows.map((row) => row.problem);
}

/**
 * Throw unless the roles, this database and the rights on its objects match
 * this version of the roles script, naming every difference. `admin` is as
 * for findRoleProblems().
 */
export async function assertRoles(client: pg.ClientBase, admin?: string): Promise<void> {
  const problems = [
    ...(await findRoleProblems(client, admin)),
    ...(await findObjectRightProblems(client)),
  ];
  if (problems.length > 0) {
    throw new Error(
      [
        'The database roles do not match the roles script:',
        ...problems.map((problem) => `  - ${problem}`),
        'Run the roles script (pnpm db:migrate does this in development), and fix by hand anything it reports that its role cannot change.',
      ].join('\n'),
    );
  }
}
