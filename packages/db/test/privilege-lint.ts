// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rights half of the schema lint (ADR 0003, "Checks"). It returns, as
// sentences, every way the database breaks these rules.
//
// In every schema but PostgreSQL's own, excepted ones included:
// - PUBLIC holds no right on any schema, table, view, sequence or column,
//   beyond PUBLIC_RIGHTS, and no app role holds TRUNCATE, REFERENCES or
//   TRIGGER.
// - No function is executable by PUBLIC, and the app roles can execute
//   exactly the functions in EXECUTABLE_BY.
// - A function is SECURITY DEFINER only if DEFINER_FUNCTIONS approves it.
//   Each approved one pins search_path to pg_catalog, pg_temp and belongs
//   to its owner role, which owns nothing else and holds exactly the rights
//   and policies listed (ADR 0003, "Approved definer functions").
//
// For the app roles and the database:
// - The roles match the roles script (findRoleProblems in
//   packages/db/scripts/roles.ts): attributes, memberships and settings.
// - No setting applies to every role in this database or in all of them,
//   such as one set by ALTER DATABASE ... SET search_path.
// - No app role owns anything (sequences included), has CREATE on any
//   schema, can use an excepted schema, or has CREATE or TEMPORARY on the
//   database.
// - No app role holds any right WITH GRANT OPTION, and app_auth and
//   app_queue hold rights only in their own schemas, beyond those listed in
//   OWN_SCHEMAS (ADR 0003, "Roles").
// - No default privileges grant anything to a role other than the objects'
//   owner, so nothing a migration creates starts with a grant.
// - There is no publication: logical replication ignores row-level security.
// - On each of AUDIT_TABLES, app roles hold no right but INSERT and SELECT,
//   and cannot insert occurred_at or retain_until (ADR 0003, "Checks").
//
// It reads only catalogues that PUBLIC can read, so any role can run it.

import type pg from 'pg';

import { findRoleProblems } from '../scripts/roles.ts';
import { APP_ROLES, type AppRole } from './connect.ts';

/** The functions that app roles may execute, and by whom. */
export const EXECUTABLE_BY: ReadonlyMap<string, readonly AppRole[]> = new Map<
  string,
  readonly AppRole[]
>([
  // Every tenant policy calls it, whichever role runs the query.
  ['app.current_tenant_id()', APP_ROLES],
  // How the API learns about a session, without any grant in schema auth.
  ['auth.session_context(bytea)', ['app_api']],
  // A session's memberships, for switching tenant (ADR 0019).
  ['auth.session_memberships(bytea)', ['app_api']],
  // Public tenant pages and sign-in, with no tenant set (ADR 0019).
  ['app.public_tenant(text)', ['app_api', 'app_auth']],
  ['app.public_tenant_logo(text)', ['app_api']],
  // The operator command alone (ADR 0019).
  ['app.create_tenant(text, text)', ['app_worker']],
]);

interface DefinerFunction {
  readonly owner: string;
  /** Every right the owner holds, as "<privilege> on <object>". */
  readonly rights: readonly string[];
  /** Every policy that names the owner, as "<table> policy <name>". */
  readonly policies: readonly string[];
}

/** The approved SECURITY DEFINER functions (ADR 0003), by signature. */
export const DEFINER_FUNCTIONS: ReadonlyMap<string, DefinerFunction> = new Map([
  [
    'auth.session_context(bytea)',
    {
      owner: 'owner_auth_session_context',
      rights: [
        'USAGE on schema auth',
        ...['id', 'status'].map((column) => `SELECT on column auth.user.${column}`),
        ...[
          'token_hash',
          'user_id',
          'active_tenant_id',
          'app',
          'mfa_state',
          'expires_at',
          'created_at',
          'last_seen_at',
          'reauthenticated_at',
          'revoked_at',
        ].map((column) => `SELECT on column auth.session.${column}`),
      ],
      policies: [
        'auth.session policy session_context_select',
        'auth.user policy session_context_select',
      ],
    },
  ],
  [
    'auth.session_memberships(bytea)',
    {
      owner: 'owner_auth_session_memberships',
      rights: [
        'USAGE on schema app',
        'USAGE on schema auth',
        ...['id', 'status'].map((column) => `SELECT on column auth.user.${column}`),
        ...[
          'token_hash',
          'user_id',
          'app',
          'mfa_state',
          'expires_at',
          'created_at',
          'last_seen_at',
          'revoked_at',
        ].map((column) => `SELECT on column auth.session.${column}`),
        ...['id', 'tenant_id', 'user_id', 'roles', 'status'].map(
          (column) => `SELECT on column app.membership.${column}`,
        ),
        ...['id', 'slug', 'name', 'status'].map(
          (column) => `SELECT on column app.tenant.${column}`,
        ),
      ],
      policies: [
        'app.membership policy session_memberships_select',
        'app.tenant policy session_memberships_select',
        'auth.session policy session_memberships_select',
        'auth.user policy session_memberships_select',
      ],
    },
  ],
  [
    'app.public_tenant(text)',
    {
      owner: 'owner_app_public_tenant',
      rights: [
        'USAGE on schema app',
        ...['id', 'slug', 'name', 'status'].map(
          (column) => `SELECT on column app.tenant.${column}`,
        ),
        ...['tenant_id', 'brand_colour', 'preset', 'logo_type'].map(
          (column) => `SELECT on column app.tenant_theme.${column}`,
        ),
      ],
      policies: [
        'app.tenant policy public_tenant_select',
        'app.tenant_theme policy public_tenant_select',
      ],
    },
  ],
  [
    'app.public_tenant_logo(text)',
    {
      owner: 'owner_app_public_tenant_logo',
      rights: [
        'USAGE on schema app',
        ...['id', 'slug', 'status'].map((column) => `SELECT on column app.tenant.${column}`),
        ...['tenant_id', 'logo', 'logo_type'].map(
          (column) => `SELECT on column app.tenant_theme.${column}`,
        ),
      ],
      policies: [
        'app.tenant policy public_tenant_logo_select',
        'app.tenant_theme policy public_tenant_logo_select',
      ],
    },
  ],
  [
    'app.create_tenant(text, text)',
    {
      owner: 'owner_app_create_tenant',
      rights: [
        'USAGE on schema app',
        ...['id', 'slug', 'name'].map((column) => `INSERT on column app.tenant.${column}`),
      ],
      policies: ['app.tenant policy create_tenant_insert'],
    },
  ],
]);

/** The pinned search_path of every approved definer function, as pg_proc stores it. */
const DEFINER_CONFIG = 'search_path=pg_catalog, pg_temp';

/** The append-only audit tables, whose occurred_at and retain_until the database sets. */
export const AUDIT_TABLES: readonly string[] = ['app.audit_event', 'auth.audit_event'];

/** Rights PUBLIC may hold, as "<privilege> on <object>", each with its reason. */
export const PUBLIC_RIGHTS: ReadonlyMap<string, string> = new Map([
  [
    'USAGE on schema public',
    "PostgreSQL's own grant on the public schema, which no migration uses. Remove this entry once the database privileges script revokes it.",
  ],
]);

/**
 * The schema each of app_auth and app_queue has its rights in, and the only
 * rights, as "<privilege> on <object>", it may hold outside it (ADR 0003).
 */
export const OWN_SCHEMAS: ReadonlyMap<string, { schema: string; outside: readonly string[] }> =
  new Map([
    [
      'app_auth',
      {
        schema: 'auth',
        outside: [
          'USAGE on schema app',
          'EXECUTE on function app.current_tenant_id()',
          'EXECUTE on function app.public_tenant(text)',
        ],
      },
    ],
    [
      'app_queue',
      {
        schema: 'pgboss',
        outside: ['USAGE on schema app', 'EXECUTE on function app.current_tenant_id()'],
      },
    ],
  ]);

/** Any schema but PostgreSQL's own. */
export const NON_SYSTEM_SCHEMA = `NOT pg_catalog.starts_with(n.nspname, 'pg_')
  AND n.nspname <> 'information_schema'`;

/** The kinds of object pg_default_acl names, as an error message says them. */
const DEFAULT_ACL_OBJECTS: Readonly<Record<string, string>> = {
  r: 'tables',
  S: 'sequences',
  f: 'functions',
  T: 'types',
  n: 'schemas',
  L: 'large objects',
};

interface FunctionRow {
  signature: string;
  definer: boolean;
  owner: string;
  config: string[];
  public_execute: boolean;
  executable_by: string[];
}

/** Every rights problem. `excepted` lists the schemas no app role may use. */
export async function findPrivilegeProblems(
  client: pg.ClientBase,
  excepted: readonly string[],
): Promise<string[]> {
  const problems = await privilegeProblems(client);
  problems.push(...(await roleProblems(client, excepted)));
  problems.push(...(await appRoleGrantProblems(client)));
  problems.push(...(await defaultPrivilegeProblems(client)));
  problems.push(...(await functionProblems(client)));
  problems.push(...(await definerOwnerProblems(client)));
  problems.push(...(await auditTableProblems(client)));

  const publications = await client.query<{ name: string }>(
    'SELECT pubname AS name FROM pg_catalog.pg_publication ORDER BY 1',
  );
  for (const { name } of publications.rows) {
    problems.push(
      `Publication ${name} exists. Logical replication ignores row-level security, so none is approved.`,
    );
  }
  return problems;
}

/** Rights held by PUBLIC, and TRUNCATE, REFERENCES and TRIGGER held by app roles. */
async function privilegeProblems(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ name: string; grantee: string; privilege: string }>(
    `SELECT name, CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE grantee::regrole::text END AS grantee,
            privilege
       FROM (
         SELECT n.nspname || '.' || c.relname AS name, a.grantee, a.privilege_type AS privilege
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
          WHERE ${NON_SYSTEM_SCHEMA} AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
         UNION ALL
         SELECT 'column ' || n.nspname || '.' || c.relname || '.' || t.attname,
                a.grantee, a.privilege_type
           FROM pg_catalog.pg_attribute t
           JOIN pg_catalog.pg_class c ON c.oid = t.attrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(t.attacl) a
          WHERE ${NON_SYSTEM_SCHEMA} AND t.attnum > 0 AND NOT t.attisdropped
         UNION ALL
         SELECT 'schema ' || n.nspname, a.grantee, a.privilege_type
           FROM pg_catalog.pg_namespace n
          CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
          WHERE ${NON_SYSTEM_SCHEMA}
       ) grants
      WHERE grantee = 0
         OR (grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY ($1::text[]))
             AND privilege IN ('TRUNCATE', 'REFERENCES', 'TRIGGER'))
      ORDER BY 1, 2, 3`,
    [APP_ROLES],
  );
  return rows
    .filter(
      ({ name, grantee, privilege }) =>
        grantee !== 'PUBLIC' || !PUBLIC_RIGHTS.has(`${privilege} on ${name}`),
    )
    .map(
      ({ name, grantee, privilege }) =>
        `${grantee === 'PUBLIC' ? 'PUBLIC' : `Role ${grantee}`} holds ${privilege} on ${name}.`,
    );
}

/**
 * Rights the app roles hold WITH GRANT OPTION, and rights app_auth and
 * app_queue hold outside their own schemas, in every schema including
 * PostgreSQL's own.
 */
async function appRoleGrantProblems(client: pg.ClientBase): Promise<string[]> {
  const problems: string[] = [];
  for (const { role, schema, object, privilege, grantable } of await heldRights(
    client,
    APP_ROLES,
  )) {
    const right = `${privilege} on ${object}`;
    if (grantable) problems.push(`Role ${role} holds ${right} with grant option.`);
    const own = OWN_SCHEMAS.get(role);
    if (own && schema !== null && schema !== own.schema && !own.outside.includes(right)) {
      problems.push(`Role ${role} holds ${right}, outside its own schema ${own.schema}.`);
    }
  }
  return problems;
}

interface HeldRight {
  role: string;
  schema: string | null;
  object: string;
  privilege: string;
  grantable: boolean;
}

/**
 * The rights `roles` hold in every schema, including PostgreSQL's own, and
 * on the database, leaving out an owner's rights on what it owns.
 */
async function heldRights(client: pg.ClientBase, roles: readonly string[]): Promise<HeldRight[]> {
  const { rows } = await client.query<HeldRight>(
    `SELECT r.rolname AS role, o.schema, o.object, a.privilege_type AS privilege,
            a.is_grantable AS grantable
       FROM (
         SELECT n.nspname AS schema, n.nspname || '.' || c.relname AS object, c.relacl AS acl
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         UNION ALL
         SELECT n.nspname, 'column ' || n.nspname || '.' || c.relname || '.' || t.attname, t.attacl
           FROM pg_catalog.pg_attribute t
           JOIN pg_catalog.pg_class c ON c.oid = t.attrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE t.attnum > 0 AND NOT t.attisdropped
         UNION ALL
         SELECT n.nspname, 'function ' || p.oid::pg_catalog.regprocedure::text, p.proacl
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         UNION ALL
         SELECT n.nspname, 'type ' || t.oid::pg_catalog.regtype::text, t.typacl
           FROM pg_catalog.pg_type t
           JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
         UNION ALL
         SELECT n.nspname, 'schema ' || n.nspname, n.nspacl FROM pg_catalog.pg_namespace n
         UNION ALL
         SELECT NULL, 'the database', d.datacl
           FROM pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database()
       ) o
      CROSS JOIN LATERAL pg_catalog.aclexplode(o.acl) a
       JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE r.rolname = ANY ($1::text[]) AND a.grantor <> a.grantee
      ORDER BY 1, 3, 4`,
    [roles],
  );
  return rows;
}

/**
 * Each approved definer function's owner: it owns that function and nothing
 * else in this database, and holds exactly its listed rights and policies.
 * findRoleProblems() checks the owner role's attributes and memberships.
 */
async function definerOwnerProblems(client: pg.ClientBase): Promise<string[]> {
  const owners = [...DEFINER_FUNCTIONS.values()].map((approved) => approved.owner);
  const owned = await client.query<{ role: string; object: string }>(
    `SELECT r.rolname AS role,
            pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid) AS object
       FROM pg_catalog.pg_shdepend d
       JOIN pg_catalog.pg_roles r ON r.oid = d.refobjid
      WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
        AND d.deptype = 'o'
        AND d.dbid IN (0, (SELECT oid FROM pg_catalog.pg_database
                            WHERE datname = pg_catalog.current_database()))
        AND r.rolname = ANY ($1::text[])`,
    [owners],
  );
  const policies = await client.query<{ role: string; policy: string }>(
    `SELECT r.rolname AS role,
            n.nspname || '.' || c.relname || ' policy ' || p.polname AS policy
       FROM pg_catalog.pg_policy p
       JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_roles r ON r.oid = ANY (p.polroles)
      WHERE r.rolname = ANY ($1::text[])`,
    [owners],
  );
  const rights = await heldRights(client, owners);

  const problems: string[] = [];
  const compare = (owner: string, kind: string, actual: string[], expected: readonly string[]) => {
    for (const item of actual.filter((entry) => !expected.includes(entry))) {
      problems.push(`Function owner ${owner} ${kind} ${item}, which is not approved.`);
    }
    for (const item of expected.filter((entry) => !actual.includes(entry))) {
      problems.push(`Function owner ${owner} lacks ${item}, which DEFINER_FUNCTIONS lists.`);
    }
  };
  for (const [signature, approved] of DEFINER_FUNCTIONS) {
    const { owner } = approved;
    const mine = <T extends { role: string }>(rows: T[]) =>
      rows.filter((row) => row.role === owner);
    // pg_describe_object prints a function's arguments without spaces.
    compare(
      owner,
      'owns',
      mine(owned.rows).map((row) => row.object),
      [`function ${signature.replaceAll(', ', ',')}`],
    );
    compare(
      owner,
      'holds',
      mine(rights).map((row) => `${row.privilege} on ${row.object}`),
      approved.rights,
    );
    compare(
      owner,
      'is named in',
      mine(policies.rows).map((row) => row.policy),
      approved.policies,
    );
  }
  return problems;
}

/** Default privileges that grant anything to a role other than the objects' owner. */
async function defaultPrivilegeProblems(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{
    owner: string;
    schema: string | null;
    kind: string;
    grantee: string;
    privilege: string;
  }>(
    `SELECT d.defaclrole::regrole::text AS owner,
            CASE WHEN d.defaclnamespace <> 0 THEN d.defaclnamespace::regnamespace::text END
              AS schema,
            d.defaclobjtype AS kind,
            CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
            a.privilege_type AS privilege
       FROM pg_catalog.pg_default_acl d
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
      WHERE a.grantee <> d.defaclrole
      ORDER BY 1, 2, 3, 4, 5`,
  );
  return rows.map(({ owner, schema, kind, grantee, privilege }) => {
    const where = schema === null ? '' : ` in schema ${schema}`;
    const objects = DEFAULT_ACL_OBJECTS[kind] ?? kind;
    return `Default privileges for role ${owner}${where} grant ${privilege} on new ${objects} to ${grantee}.`;
  });
}

async function roleProblems(client: pg.ClientBase, excepted: readonly string[]): Promise<string[]> {
  // Attributes, memberships, settings and the database's own rights.
  const problems = await findRoleProblems(client);

  // Ownership of anything in this database, sequences included, or of a
  // shared object such as the database itself.
  const owned = await client.query<{ role: string; object: string }>(
    `SELECT r.rolname AS role,
            pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid) AS object
       FROM pg_catalog.pg_shdepend d
       JOIN pg_catalog.pg_roles r ON r.oid = d.refobjid
      WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
        AND d.deptype = 'o'
        AND d.dbid IN (0, (SELECT oid FROM pg_catalog.pg_database
                            WHERE datname = pg_catalog.current_database()))
        AND r.rolname = ANY ($1::text[])
      ORDER BY 1, 2`,
    [APP_ROLES],
  );
  for (const { role, object } of owned.rows) problems.push(`Role ${role} owns ${object}.`);

  const schemas = await client.query<{ role: string; schema: string; can_create: boolean }>(
    `SELECT r.name AS role, n.nspname AS schema,
            pg_catalog.has_schema_privilege(r.name, n.oid, 'CREATE') AS can_create
       FROM pg_catalog.pg_namespace n
      CROSS JOIN pg_catalog.unnest($1::text[]) AS r(name)
      WHERE pg_catalog.has_schema_privilege(r.name, n.oid, 'CREATE')
         OR (n.nspname = ANY ($2::text[])
             AND pg_catalog.has_schema_privilege(r.name, n.oid, 'USAGE'))
      ORDER BY 1, 2`,
    [APP_ROLES, excepted],
  );
  for (const { role, schema, can_create } of schemas.rows) {
    problems.push(
      can_create
        ? `Role ${role} can create objects in schema ${schema}.`
        : `Role ${role} can use the excepted schema ${schema}.`,
    );
  }

  const database = await client.query<{ role: string; can_create: boolean; can_temp: boolean }>(
    `SELECT r.name AS role,
            pg_catalog.has_database_privilege(r.name, pg_catalog.current_database(), 'CREATE')
              AS can_create,
            pg_catalog.has_database_privilege(r.name, pg_catalog.current_database(), 'TEMPORARY')
              AS can_temp
       FROM pg_catalog.unnest($1::text[]) AS r(name)
      ORDER BY 1`,
    [APP_ROLES],
  );
  for (const { role, can_create, can_temp } of database.rows) {
    if (can_create) problems.push(`Role ${role} can create schemas in this database.`);
    if (can_temp) problems.push(`Role ${role} can create temporary tables in this database.`);
  }

  // Settings for every role, here or in all databases. findRoleProblems
  // covers settings for the login roles themselves. Names only, no values.
  const settings = await client.query<{ name: string }>(
    `SELECT DISTINCT pg_catalog.split_part(c.setting, '=', 1) AS name
       FROM pg_catalog.pg_db_role_setting s
      CROSS JOIN pg_catalog.unnest(s.setconfig) AS c(setting)
      WHERE s.setrole = 0
        AND s.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database
                                   WHERE datname = pg_catalog.current_database()))
      ORDER BY 1`,
  );
  for (const { name } of settings.rows) {
    problems.push(
      `${name} is set for every session in this database. Settings for every role are not approved.`,
    );
  }
  return problems;
}

/**
 * UPDATE or DELETE on AUDIT_TABLES, and INSERT on the columns the database
 * sets. privilegeProblems() already reports TRUNCATE, REFERENCES and TRIGGER.
 */
async function auditTableProblems(client: pg.ClientBase): Promise<string[]> {
  // Tables are found through the catalogue, not by casting their names, so
  // a role without USAGE on a table's schema can still run this.
  const { rows } = await client.query<{ problem: string }>(
    `WITH t AS (
       SELECT l.name, c.oid
         FROM pg_catalog.unnest($1::text[]) AS l(name)
         LEFT JOIN (pg_catalog.pg_class c
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace)
           ON n.nspname || '.' || c.relname = l.name AND c.relkind = 'r'
     )
     SELECT pg_catalog.format('Audit table %s does not exist.', t.name) AS problem
       FROM t
      WHERE t.oid IS NULL
     UNION ALL
     SELECT pg_catalog.format('Role %s holds %s on the audit table %s.', r.name, p.privilege, t.name)
       FROM t
      CROSS JOIN pg_catalog.unnest($2::text[]) AS r(name)
      CROSS JOIN (VALUES ('UPDATE'), ('DELETE')) AS p(privilege)
      WHERE t.oid IS NOT NULL
        AND CASE p.privilege
              WHEN 'UPDATE' THEN pg_catalog.has_any_column_privilege(r.name, t.oid, 'UPDATE')
              ELSE pg_catalog.has_table_privilege(r.name, t.oid, 'DELETE') END
     UNION ALL
     SELECT pg_catalog.format('Role %s can insert %s.%s, which the database sets.',
                              r.name, t.name, a.attname)
       FROM t
       JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
      CROSS JOIN pg_catalog.unnest($2::text[]) AS r(name)
      WHERE a.attname IN ('occurred_at', 'retain_until') AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege(r.name, a.attrelid, a.attnum, 'INSERT')`,
    [AUDIT_TABLES, APP_ROLES],
  );
  return rows.map((row) => row.problem);
}

/** Functions in every schema but PostgreSQL's own, excepted ones included. */
async function functionProblems(client: pg.ClientBase): Promise<string[]> {
  const functions = await client.query<FunctionRow>(
    `SELECT n.nspname || '.' || p.proname
              || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS signature,
            p.prosecdef AS definer, p.proowner::pg_catalog.regrole::text AS owner,
            COALESCE(p.proconfig, '{}') AS config,
            EXISTS (
              SELECT FROM pg_catalog.aclexplode(
                COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
            ) AS public_execute,
            ARRAY(
              SELECT r.name FROM pg_catalog.unnest($1::text[]) AS r(name)
               WHERE pg_catalog.has_function_privilege(r.name, p.oid, 'EXECUTE')
               ORDER BY 1
            ) AS executable_by
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE ${NON_SYSTEM_SCHEMA}
      ORDER BY 1`,
    [APP_ROLES],
  );

  const problems: string[] = [];
  for (const row of functions.rows) {
    const { signature } = row;
    const approved = DEFINER_FUNCTIONS.get(signature);
    if (row.definer && !approved) {
      problems.push(`${signature} is SECURITY DEFINER and is not an approved definer function.`);
    }
    if (approved && !row.definer) problems.push(`${signature} is not SECURITY DEFINER.`);
    if (approved && row.owner !== approved.owner) {
      problems.push(`${signature} is owned by ${row.owner}, not ${approved.owner}.`);
    }
    if (approved && row.config.join('; ') !== DEFINER_CONFIG) {
      problems.push(`${signature} does not set only ${DEFINER_CONFIG}.`);
    }
    if (row.public_execute) problems.push(`PUBLIC can execute ${signature}.`);
    const actual = [...row.executable_by].sort().join(', ') || 'no app role';
    const expected = [...(EXECUTABLE_BY.get(signature) ?? [])].sort().join(', ') || 'no app role';
    if (actual !== expected) {
      problems.push(`${signature} is executable by ${actual}; EXECUTABLE_BY allows ${expected}.`);
    }
  }
  for (const [list, signatures] of [
    ['EXECUTABLE_BY', EXECUTABLE_BY.keys()],
    ['DEFINER_FUNCTIONS', DEFINER_FUNCTIONS.keys()],
  ] as const) {
    for (const signature of signatures) {
      if (!functions.rows.some((row) => row.signature === signature)) {
        problems.push(`${signature} is listed in ${list} but does not exist.`);
      }
    }
  }
  return problems;
}
