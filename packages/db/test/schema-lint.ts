// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The schema lint (ADR 0003, "Checks"). It reads PostgreSQL's catalogue and
// returns, as sentences, every way the database breaks these rules, plus
// those in privilege-lint.ts.
//
// In every application schema (any schema but PostgreSQL's own and
// EXCEPTED_SCHEMAS):
// - Every table has a tenant_id uuid NOT NULL column, unless it is on
//   NON_TENANT_TABLES. A table on TENANT_KEYED_BY_ID is its own tenant, and
//   its id takes tenant_id's place in every check below.
// - Every table has row-level security enabled and forced, and at least one
//   policy, never FOR ALL. A tenant table has a policy for each of SELECT,
//   INSERT, UPDATE and DELETE.
// - Every permissive policy has the expressions its command needs (UPDATE
//   needs WITH CHECK too). On a tenant table, each of them is TENANT_TERM or
//   has it as a top-level AND term, so no OR can widen it.
// - A command that no app role may run on a table has a restrictive policy
//   for it, applying to every app role, that is USING (false), or WITH
//   CHECK (false) for INSERT (ADR 0003 rule 4).
// - A tenant table has UNIQUE (tenant_id, id), and every foreign key from
//   one tenant table to another matches tenant_id to tenant_id (rule 6).
// - Every column is in classification.ts, the map names no column that does
//   not exist, and each retention rule makes sense.
// - Views use security_invoker. There are no materialized views or foreign
//   tables.
//
// In every schema but PostgreSQL's own, there is no user-defined operator,
// which could stand in for a built-in one, and no rewrite rule on a table,
// since rules run with the table owner's rights. app.current_tenant_id(),
// which every tenant policy calls, is exactly CURRENT_TENANT_ID_DEFINITION.
//
// It reads only catalogues that PUBLIC can read, so any role can run it. The
// schema-lint test runs it as each app role. It first sets the client's
// search_path to pg_catalog alone, so its own queries, and the policy
// expressions it reads, resolve every name there; an operator from any other
// schema prints with that schema's name.

import type pg from 'pg';

import type { ClassificationRegistry, FieldClassification } from '../classification.ts';
import { APP_ROLES } from './connect.ts';
import { findPrivilegeProblems, NON_SYSTEM_SCHEMA } from './privilege-lint.ts';

/** Tables in an application schema without tenant_id, each with its reason. */
export const NON_TENANT_TABLES: ReadonlyMap<string, string> = new Map(
  (
    [
      [
        'auth.user',
        'An account belongs to one person and may hold memberships in several tenants.',
      ],
      ['auth.session', 'A session belongs to an account; its active tenant grants nothing alone.'],
      ['auth.account', 'Credential accounts have no tenant; SSO identities add one later.'],
      ['auth.verification', 'Emailed links come before any tenant is known.'],
      ['auth.two_factor', 'MFA belongs to the account, whatever the tenant.'],
      ['auth.rate_limit', 'Sign-in limits count identifiers and addresses, not tenants.'],
      ['auth.audit_event', 'Some auth events have no tenant, such as a failed sign-in.'],
      ['auth.audit_copy_pending', 'It holds only an auth event id and a time.'],
    ] as const
  ).map(([table, reason]) => [
    table,
    `${reason} On ADR 0003's allowlist: only app_auth and the function owners have grants.`,
  ]),
);

/** Tenant tables whose own id is the tenant, each with its reason. */
export const TENANT_KEYED_BY_ID: ReadonlyMap<string, string> = new Map([
  [
    'app.tenant',
    'Each row is a tenant, so its policies use id = app.current_tenant_id() (ADR 0003).',
  ],
]);

/** The column that holds a tenant table's tenant. */
export function tenantColumn(table: string): string {
  return TENANT_KEYED_BY_ID.has(table) ? 'id' : 'tenant_id';
}

/**
 * app.current_tenant_id() as pg_get_functiondef prints it with search_path
 * set to pg_catalog alone (ADR 0003, row-level security rule 5).
 */
export const CURRENT_TENANT_ID_DEFINITION = `CREATE OR REPLACE FUNCTION app.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE PARALLEL SAFE
RETURN (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid
`;

/** Schemas the table, policy and classification checks skip, each with its reason. */
export const EXCEPTED_SCHEMAS: ReadonlyMap<string, string> = new Map([
  [
    'migrations',
    "Kysely's migration history, which only migrator uses. The lint checks that no app role can use the schema, and checks its grants and functions like any other.",
  ],
]);

/** The tenant term for a table whose tenant is in `column`, as pg_get_expr prints it. */
function tenantTerm(column: string): string {
  return `(${column} = app.current_tenant_id())`;
}

export const TENANT_TERM = tenantTerm('tenant_id');

const COMMANDS: Readonly<Record<string, string>> = {
  r: 'SELECT',
  a: 'INSERT',
  w: 'UPDATE',
  d: 'DELETE',
  '*': 'ALL',
};

/** The expressions each command's permissive policy must have. */
const CLAUSES: Readonly<Record<string, readonly ('using' | 'with_check')[]>> = {
  r: ['using'],
  a: ['with_check'],
  w: ['using', 'with_check'],
  d: ['using'],
  '*': ['using'],
};

const TIMESTAMP_TYPES = new Set([
  'timestamp with time zone',
  'timestamp without time zone',
  'date',
]);

/** A schema that is neither PostgreSQL's own nor excepted. $1 lists the excepted ones. */
const APPLICATION_SCHEMA = `${NON_SYSTEM_SCHEMA} AND n.nspname <> ALL ($1::text[])`;

interface RelationRow {
  name: string;
  kind: string;
  rls: boolean;
  forced: boolean;
  options: string[];
}

interface ColumnRow {
  table: string;
  column: string;
  type: string;
  not_null: boolean;
}

interface PolicyRow {
  table: string;
  name: string;
  command: string;
  permissive: boolean;
  roles: string[];
  using: string | null;
  with_check: string | null;
}

/** A primary key (p), unique constraint (u) or foreign key (f), with columns in key order. */
interface ConstraintRow {
  table: string;
  name: string;
  kind: string;
  columns: string[];
  referenced: string | null;
  referenced_columns: string[];
}

/** What one table's checks need besides the table itself. */
interface TableFacts {
  policies: PolicyRow[];
  columns: ColumnRow[];
  constraints: ConstraintRow[];
  /** The commands, as polcmd letters, that no app role may run. */
  ungranted: string[];
}

export async function findSchemaProblems(
  client: pg.ClientBase,
  registry: ClassificationRegistry,
): Promise<string[]> {
  const excepted = [...EXCEPTED_SCHEMAS.keys()];
  await client.query('SET search_path = pg_catalog');

  const relations = await client.query<RelationRow>(
    `SELECT n.nspname || '.' || c.relname AS name, c.relkind AS kind,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            COALESCE(c.reloptions, '{}') AS options
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${APPLICATION_SCHEMA} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      ORDER BY 1`,
    [excepted],
  );
  const columns = await client.query<ColumnRow>(
    `SELECT n.nspname || '.' || c.relname AS table, a.attname AS column,
            pg_catalog.format_type(a.atttypid, NULL) AS type, a.attnotnull AS not_null
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${APPLICATION_SCHEMA} AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY 1, 2`,
    [excepted],
  );
  const policies = await client.query<PolicyRow>(
    `SELECT n.nspname || '.' || c.relname AS table, p.polname AS name, p.polcmd AS command,
            p.polpermissive AS permissive,
            ARRAY(SELECT CASE WHEN r.id = 0 THEN 'public' ELSE r.id::regrole::text END
                    FROM pg_catalog.unnest(p.polroles) AS r(id) ORDER BY 1) AS roles,
            pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using,
            pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
       FROM pg_catalog.pg_policy p
       JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${APPLICATION_SCHEMA}
      ORDER BY 1, 2`,
    [excepted],
  );
  const constraints = await client.query<ConstraintRow>(
    `SELECT n.nspname || '.' || c.relname AS table, o.conname AS name, o.contype AS kind,
            ARRAY(SELECT a.attname::text
                    FROM pg_catalog.unnest(o.conkey) WITH ORDINALITY AS k(attnum, position)
                    JOIN pg_catalog.pg_attribute a
                      ON a.attrelid = o.conrelid AND a.attnum = k.attnum
                   ORDER BY k.position) AS columns,
            fn.nspname || '.' || fc.relname AS referenced,
            ARRAY(SELECT a.attname::text
                    FROM pg_catalog.unnest(o.confkey) WITH ORDINALITY AS k(attnum, position)
                    JOIN pg_catalog.pg_attribute a
                      ON a.attrelid = o.confrelid AND a.attnum = k.attnum
                   ORDER BY k.position) AS referenced_columns
       FROM pg_catalog.pg_constraint o
       JOIN pg_catalog.pg_class c ON c.oid = o.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_catalog.pg_class fc ON fc.oid = o.confrelid
       LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
      WHERE ${APPLICATION_SCHEMA} AND o.contype IN ('p', 'u', 'f')
      ORDER BY 1, 2`,
    [excepted],
  );
  // Commands for which no app role holds the right on the table or any column.
  const ungranted = await client.query<{ table: string; command: string }>(
    `SELECT n.nspname || '.' || c.relname AS table, m.command
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('r', 'SELECT'), ('a', 'INSERT'), ('w', 'UPDATE'), ('d', 'DELETE'))
              AS m(command, privilege)
      WHERE ${APPLICATION_SCHEMA} AND c.relkind IN ('r', 'p')
        AND NOT EXISTS (
          SELECT FROM pg_catalog.unnest($2::text[]) AS r(name)
           WHERE CASE m.command
                   WHEN 'd' THEN pg_catalog.has_table_privilege(r.name, c.oid, 'DELETE')
                   ELSE pg_catalog.has_any_column_privilege(r.name, c.oid, m.privilege)
                 END)
      ORDER BY 1, 2`,
    [excepted, APP_ROLES],
  );

  const problems: string[] = [];
  const tenantTables = new Set<string>();
  for (const relation of relations.rows) {
    const { name } = relation;
    if (relation.kind === 'm') {
      problems.push(`${name} is a materialized view, and none is approved.`);
    } else if (relation.kind === 'f') {
      problems.push(`${name} is a foreign table, and none is approved.`);
    } else if (relation.kind === 'v') {
      if (!relation.options.some((option) => /^security_invoker=(true|on|yes|1)$/i.test(option))) {
        problems.push(`${name} is a view without security_invoker.`);
      }
    } else {
      if (!NON_TENANT_TABLES.has(name)) tenantTables.add(name);
      problems.push(
        ...tableProblems(relation, {
          policies: policies.rows.filter((row) => row.table === name),
          columns: columns.rows.filter((row) => row.table === name),
          constraints: constraints.rows.filter((row) => row.table === name),
          ungranted: ungranted.rows.filter((row) => row.table === name).map((row) => row.command),
        }),
      );
    }
  }
  problems.push(...foreignKeyProblems(constraints.rows, tenantTables));
  problems.push(...classificationProblems(registry, columns.rows));

  const tenantFunction = await client.query<{ definition: string | null }>(
    `SELECT pg_catalog.pg_get_functiondef(p) AS definition
       FROM pg_catalog.to_regprocedure('app.current_tenant_id()') AS p`,
  );
  if (tenantFunction.rows[0]?.definition !== CURRENT_TENANT_ID_DEFINITION) {
    problems.push(
      'app.current_tenant_id() is not defined as CURRENT_TENANT_ID_DEFINITION (ADR 0003, row-level security rule 5).',
    );
  }

  const operators = await client.query<{ operator: string }>(
    `SELECT o.oid::pg_catalog.regoperator::text AS operator
       FROM pg_catalog.pg_operator o
       JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace
      WHERE ${NON_SYSTEM_SCHEMA}
      ORDER BY 1`,
  );
  for (const { operator } of operators.rows) {
    problems.push(
      `Operator ${operator} exists. A user-defined operator can stand in for a built-in one, so none is approved.`,
    );
  }
  const rules = await client.query<{ table: string; rule: string }>(
    `SELECT n.nspname || '.' || c.relname AS table, r.rulename AS rule
       FROM pg_catalog.pg_rewrite r
       JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${NON_SYSTEM_SCHEMA} AND c.relkind IN ('r', 'p')
      ORDER BY 1, 2`,
  );
  for (const { table, rule } of rules.rows) {
    problems.push(
      `${table} has rewrite rule ${rule}. Rules run with the table owner's rights, so none is approved.`,
    );
  }

  problems.push(...(await findPrivilegeProblems(client, excepted)));
  return problems.sort();
}

function tableProblems(relation: RelationRow, facts: TableFacts): string[] {
  const { name } = relation;
  const { policies, columns } = facts;
  const tenantTable = !NON_TENANT_TABLES.has(name);
  const commands = policies.map((policy) => policy.command);
  const problems: string[] = [];
  if (!relation.rls) problems.push(`${name} does not enable row-level security.`);
  if (!relation.forced) problems.push(`${name} does not force row-level security.`);
  if (commands.length === 0) problems.push(`${name} has no row-level security policy.`);
  if (commands.includes('*')) {
    problems.push(`${name} has a FOR ALL policy. Write one policy per command.`);
  }
  for (const command of facts.ungranted) {
    if (!policies.some((policy) => deniesEveryAppRole(policy, command))) {
      const verb = COMMANDS[command] ?? command;
      const clause = command === 'a' ? 'WITH CHECK' : 'USING';
      problems.push(
        `${name} grants ${verb} to no app role, and has no restrictive ${verb} policy with ${clause} (false) for every app role.`,
      );
    }
  }
  for (const policy of policies) problems.push(...policyProblems(name, policy, tenantTable));
  if (!tenantTable) return problems;

  const column = tenantColumn(name);
  const tenant = columns.find((row) => row.column === column);
  if (tenant?.type !== 'uuid' || !tenant.not_null) {
    problems.push(
      `${name} has no ${column} uuid NOT NULL column and is not on the list of non-tenant tables.`,
    );
  }
  const keys = facts.constraints.filter((key) => key.kind !== 'f');
  if (
    column === 'tenant_id' &&
    !keys.some((key) => [...key.columns].sort().join(',') === 'id,tenant_id')
  ) {
    problems.push(`${name} has no UNIQUE (tenant_id, id) constraint.`);
  }
  if (commands.length > 0) {
    for (const command of ['r', 'a', 'w', 'd']) {
      if (!commands.includes(command)) {
        problems.push(`${name} has no policy for ${COMMANDS[command] ?? command}.`);
      }
    }
  }
  return problems;
}

/**
 * Whether `policy` is ADR 0003 rule 4's denial of `command`: restrictive,
 * false, and applying to every app role.
 */
function deniesEveryAppRole(policy: PolicyRow, command: string): boolean {
  const expression = command === 'a' ? policy.with_check : policy.using;
  const { roles } = policy;
  return (
    !policy.permissive &&
    policy.command === command &&
    expression === 'false' &&
    (roles.includes('public') || APP_ROLES.every((role) => roles.includes(role)))
  );
}

/** Every foreign key from one tenant table to another matches their tenant columns. */
function foreignKeyProblems(constraints: ConstraintRow[], tenantTables: Set<string>): string[] {
  const problems: string[] = [];
  for (const key of constraints) {
    if (key.kind !== 'f' || !key.referenced) continue;
    if (!tenantTables.has(key.table) || !tenantTables.has(key.referenced)) continue;
    const from = tenantColumn(key.table);
    const to = tenantColumn(key.referenced);
    const position = key.columns.indexOf(from);
    if (position === -1 || key.referenced_columns[position] !== to) {
      problems.push(
        `${key.table} foreign key ${key.name} does not match its ${from} to ${key.referenced}.${to}.`,
      );
    }
  }
  return problems;
}

/**
 * A permissive policy must have the expressions its command needs, and on a
 * tenant table each must keep the tenant term at its top level. Restrictive
 * policies only narrow what permissive ones allow, so any content is safe.
 */
function policyProblems(table: string, policy: PolicyRow, tenantTable: boolean): string[] {
  if (!policy.permissive) return [];
  const label = `${table} policy ${policy.name} (${COMMANDS[policy.command] ?? policy.command} to ${policy.roles.join(', ')})`;
  const term = tenantTerm(tenantColumn(table));
  const problems: string[] = [];
  for (const clause of CLAUSES[policy.command] ?? []) {
    const expression = policy[clause];
    const clauseName = clause === 'using' ? 'USING' : 'WITH CHECK';
    if (expression === null) {
      problems.push(`${label} has no ${clauseName} expression.`);
    } else if (tenantTable && !hasTenantTerm(expression, term)) {
      problems.push(
        `${label} does not have ${term} as its ${clauseName} expression or a top-level AND term of it.`,
      );
    }
  }
  return problems;
}

/**
 * Whether `expression`, as pg_get_expr prints it, is the tenant term or has
 * it as a top-level AND term. pg_get_expr prints `a AND b AND c` as
 * `(a AND b AND c)`, with every comparison in its own parentheses.
 */
export function hasTenantTerm(expression: string, term = TENANT_TERM): boolean {
  if (expression === term) return true;
  if (!expression.startsWith('(') || !expression.endsWith(')')) return false;
  return splitTopLevel(expression.slice(1, -1), ' AND ').includes(term);
}

/** Split `text` at each `separator` outside parentheses and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quote) {
      // A doubled quote inside a literal closes and reopens it, which is the same.
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (depth === 0 && text.startsWith(separator, index)) {
      parts.push(text.slice(start, index));
      start = index + separator.length;
      index = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function classificationProblems(registry: ClassificationRegistry, columns: ColumnRow[]): string[] {
  const problems: string[] = [];
  for (const { table, column } of columns) {
    // Own properties only, so a column named constructor or __proto__ is
    // never taken as classified.
    const fields = Object.hasOwn(registry, table) ? registry[table] : undefined;
    const field = fields && Object.hasOwn(fields, column) ? fields[column] : undefined;
    if (field) {
      problems.push(...retentionProblems(`${table}.${column}`, field, table, columns));
    } else {
      problems.push(`${table}.${column} is not classified in classification.ts.`);
    }
  }
  for (const [table, fields] of Object.entries(registry)) {
    for (const column of Object.keys(fields)) {
      if (!columns.some((row) => row.table === table && row.column === column)) {
        problems.push(`classification.ts names ${table}.${column}, which does not exist.`);
      }
    }
  }
  return problems;
}

function retentionProblems(
  field: string,
  { retention }: FieldClassification,
  table: string,
  columns: ColumnRow[],
): string[] {
  const problems: string[] = [];
  const isWholeDays = (days: number) => Number.isInteger(days) && days > 0;
  if (retention.kind === 'fixed') {
    if (!isWholeDays(retention.days)) {
      problems.push(
        `${field} keeps values for ${String(retention.days)} days, not a whole number above 0.`,
      );
    }
    const from = columns.find((row) => row.table === table && row.column === retention.from);
    if (!from || !TIMESTAMP_TYPES.has(from.type)) {
      problems.push(
        `${field} counts its retention from ${retention.from}, which is not a date column of ${table}.`,
      );
    }
  } else if (retention.kind === 'tenant_policy') {
    if (retention.policy.trim() === '') {
      problems.push(`${field} names an empty retention policy.`);
    }
    if (!isWholeDays(retention.minimumDays)) {
      problems.push(
        `${field} has a minimum of ${String(retention.minimumDays)} days, not a whole number above 0.`,
      );
    }
  }
  return problems;
}
