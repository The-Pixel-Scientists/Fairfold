// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The schema lint (ADR 0003, "Checks"). It reads PostgreSQL's catalogue and
// returns, as sentences, every way the database breaks these rules, plus
// those in privilege-lint.ts.
//
// In every application schema (any schema but PostgreSQL's own and
// EXCEPTED_SCHEMAS):
// - Every table has a tenant_id uuid NOT NULL column, unless it is on
//   NON_TENANT_TABLES.
// - Every table has row-level security enabled and forced, and at least one
//   policy, never FOR ALL. A tenant table has a policy for each of SELECT,
//   INSERT, UPDATE and DELETE.
// - Every permissive policy has the expressions its command needs (UPDATE
//   needs WITH CHECK too). On a tenant table, each of them is TENANT_TERM or
//   has it as a top-level AND term, so no OR can widen it.
// - Every column is in classification.ts, the map names no column that does
//   not exist, and each retention rule makes sense.
// - Views use security_invoker. There are no materialized views or foreign
//   tables.
//
// In every schema but PostgreSQL's own, there is no user-defined operator,
// which could stand in for a built-in one, and no rewrite rule on a table,
// since rules run with the table owner's rights.
//
// It reads only catalogues that PUBLIC can read, so any role can run it. The
// schema-lint test runs it as each app role. It first sets the client's
// search_path to pg_catalog alone, so its own queries, and the policy
// expressions it reads, resolve every name there; an operator from any other
// schema prints with that schema's name.

import type pg from 'pg';

import type { ClassificationRegistry, FieldClassification } from '../classification.ts';
import { findPrivilegeProblems, NON_SYSTEM_SCHEMA } from './privilege-lint.ts';

/** Tables in an application schema without tenant_id, each with its reason. */
export const NON_TENANT_TABLES: ReadonlyMap<string, string> = new Map();

/** Schemas the table, policy and classification checks skip, each with its reason. */
export const EXCEPTED_SCHEMAS: ReadonlyMap<string, string> = new Map([
  [
    'migrations',
    "Kysely's migration history, which only migrator uses. The lint checks that no app role can use the schema, and checks its grants and functions like any other.",
  ],
]);

/** The tenant term as pg_get_expr prints it. */
export const TENANT_TERM = '(tenant_id = app.current_tenant_id())';

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

  const problems: string[] = [];
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
      problems.push(
        ...tableProblems(
          relation,
          policies.rows.filter((row) => row.table === name),
          columns.rows.filter((row) => row.table === name),
        ),
      );
    }
  }
  problems.push(...classificationProblems(registry, columns.rows));

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

function tableProblems(
  relation: RelationRow,
  policies: PolicyRow[],
  columns: ColumnRow[],
): string[] {
  const { name } = relation;
  const tenantTable = !NON_TENANT_TABLES.has(name);
  const commands = policies.map((policy) => policy.command);
  const problems: string[] = [];
  if (!relation.rls) problems.push(`${name} does not enable row-level security.`);
  if (!relation.forced) problems.push(`${name} does not force row-level security.`);
  if (commands.length === 0) problems.push(`${name} has no row-level security policy.`);
  if (commands.includes('*')) {
    problems.push(`${name} has a FOR ALL policy. Write one policy per command.`);
  }
  for (const policy of policies) problems.push(...policyProblems(name, policy, tenantTable));
  if (!tenantTable) return problems;

  const tenantId = columns.find((column) => column.column === 'tenant_id');
  if (tenantId?.type !== 'uuid' || !tenantId.not_null) {
    problems.push(
      `${name} has no tenant_id uuid NOT NULL column and is not on the list of non-tenant tables.`,
    );
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
 * A permissive policy must have the expressions its command needs, and on a
 * tenant table each must keep the tenant term at its top level. Restrictive
 * policies only narrow what permissive ones allow, so any content is safe.
 */
function policyProblems(table: string, policy: PolicyRow, tenantTable: boolean): string[] {
  if (!policy.permissive) return [];
  const label = `${table} policy ${policy.name} (${COMMANDS[policy.command] ?? policy.command} to ${policy.roles.join(', ')})`;
  const problems: string[] = [];
  for (const clause of CLAUSES[policy.command] ?? []) {
    const expression = policy[clause];
    const clauseName = clause === 'using' ? 'USING' : 'WITH CHECK';
    if (expression === null) {
      problems.push(`${label} has no ${clauseName} expression.`);
    } else if (tenantTable && !hasTenantTerm(expression)) {
      problems.push(
        `${label} does not have ${TENANT_TERM} as its ${clauseName} expression or a top-level AND term of it.`,
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
export function hasTenantTerm(expression: string): boolean {
  if (expression === TENANT_TERM) return true;
  if (!expression.startsWith('(') || !expression.endsWith(')')) return false;
  return splitTopLevel(expression.slice(1, -1), ' AND ').includes(TENANT_TERM);
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
