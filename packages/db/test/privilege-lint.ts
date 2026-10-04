// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rights half of the schema lint (ADR 0003, "Checks"). It returns, as
// sentences, every way the database breaks these rules.
//
// In every schema but PostgreSQL's own, excepted ones included:
// - PUBLIC holds no right on any schema, table, view, sequence or column,
//   beyond PUBLIC_RIGHTS, and no app role holds TRUNCATE, REFERENCES or
//   TRIGGER.
// - No function is SECURITY DEFINER or executable by PUBLIC, and the app
//   roles can execute exactly the functions in EXECUTABLE_BY.
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
export const EXECUTABLE_BY: ReadonlyMap<string, readonly AppRole[]> = new Map([
  // Every tenant policy calls it, whichever role runs the query.
  ['app.current_tenant_id()', APP_ROLES],
]);

/** The append-only audit tables, whose occurred_at and retain_until the database sets. */
export const AUDIT_TABLES: readonly string[] = ['app.audit_event'];

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
        outside: ['USAGE on schema app', 'EXECUTE on function app.current_tenant_id()'],
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
  const { rows } = await client.query<{
    role: string;
    schema: string | null;
    object: string;
    privilege: string;
    grantable: boolean;
  }>(
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
      WHERE r.rolname = ANY ($1::text[])
      ORDER BY 1, 3, 4`,
    [APP_ROLES],
  );

  const problems: string[] = [];
  for (const { role, schema, object, privilege, grantable } of rows) {
    const right = `${privilege} on ${object}`;
    if (grantable) problems.push(`Role ${role} holds ${right} with grant option.`);
    const own = OWN_SCHEMAS.get(role);
    if (own && schema !== null && schema !== own.schema && !own.outside.includes(right)) {
      problems.push(`Role ${role} holds ${right}, outside its own schema ${own.schema}.`);
    }
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
  const { rows } = await client.query<{ problem: string }>(
    `SELECT pg_catalog.format('Audit table %s does not exist.', t.name) AS problem
       FROM pg_catalog.unnest($1::text[]) AS t(name)
      WHERE pg_catalog.to_regclass(t.name) IS NULL
     UNION ALL
     SELECT pg_catalog.format('Role %s holds %s on the audit table %s.', r.name, p.privilege, t.name)
       FROM pg_catalog.unnest($1::text[]) AS t(name)
      CROSS JOIN pg_catalog.unnest($2::text[]) AS r(name)
      CROSS JOIN (VALUES ('UPDATE'), ('DELETE')) AS p(privilege)
      WHERE pg_catalog.to_regclass(t.name) IS NOT NULL
        AND CASE p.privilege
              WHEN 'UPDATE' THEN pg_catalog.has_any_column_privilege(r.name, t.name::regclass, 'UPDATE')
              ELSE pg_catalog.has_table_privilege(r.name, t.name::regclass, 'DELETE') END
     UNION ALL
     SELECT pg_catalog.format('Role %s can insert %s.%s, which the database sets.',
                              r.name, t.name, a.attname)
       FROM pg_catalog.unnest($1::text[]) AS t(name)
       JOIN pg_catalog.pg_attribute a ON a.attrelid = pg_catalog.to_regclass(t.name)
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
            p.prosecdef AS definer,
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
    if (row.definer) {
      problems.push(`${signature} is SECURITY DEFINER, and no definer function is approved yet.`);
    }
    if (row.public_execute) problems.push(`PUBLIC can execute ${signature}.`);
    const actual = [...row.executable_by].sort().join(', ') || 'no app role';
    const expected = [...(EXECUTABLE_BY.get(signature) ?? [])].sort().join(', ') || 'no app role';
    if (actual !== expected) {
      problems.push(`${signature} is executable by ${actual}; EXECUTABLE_BY allows ${expected}.`);
    }
  }
  for (const signature of EXECUTABLE_BY.keys()) {
    if (!functions.rows.some((row) => row.signature === signature)) {
      problems.push(`${signature} is listed in EXECUTABLE_BY but does not exist.`);
    }
  }
  return problems;
}
