// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists (privilege-lint.ts and schema-lint.ts),
// one file per schema (ADR 0016), merged here. A file names only its own
// schema's tables and functions. The entries for the database as a whole,
// rather than one schema, are at the end of this file.

import type { AppRole, SetRole } from '../connect.ts';
import { app } from './app.ts';
import { assure } from './assure.ts';
import { auth } from './auth.ts';
import { crm } from './crm.ts';
import { grants } from './grants.ts';
import { migrations } from './migrations.ts';
import { party } from './party.ts';
import { pgboss } from './pgboss.ts';

export { CURRENT_TENANT_ID_DEFINITION } from './app.ts';
export { JOB_RIGHTS, SEND_COLUMNS } from './pgboss.ts';

export interface DefinerFunction {
  readonly owner: string;
  /** Every right the owner holds, as "<privilege> on <object>". */
  readonly rights: readonly string[];
  /** Every policy that names the owner, as "<table> policy <name>". */
  readonly policies: readonly string[];
}

type Entries<T> = readonly (readonly [string, T])[];

/** One schema's entries. */
export interface SchemaCatalogue {
  /** The functions app roles may execute, and by whom. */
  readonly executableBy?: Entries<readonly (AppRole | SetRole)[]>;
  /** The approved SECURITY DEFINER functions (ADR 0003), by signature. */
  readonly definerFunctions?: Entries<DefinerFunction>;
  /** Tables without tenant_id, each with its reason. */
  readonly nonTenantTables?: Entries<string>;
  /** Tenant tables whose own id is the tenant, each with its reason. */
  readonly tenantKeyedById?: Entries<string>;
  /** Append-only audit tables, whose occurred_at and retain_until the database sets. */
  readonly auditTables?: readonly string[];
  /**
   * The app role whose rights lie in this schema alone, and the only rights,
   * as "<privilege> on <object>", it may hold outside it (ADR 0003).
   */
  readonly ownSchema?: { readonly role: AppRole; readonly outside: readonly string[] };
  /** Why the table, policy and classification checks skip the whole schema. */
  readonly excepted?: string;
  /** Why the table and policy checks skip the schema, which is still classified. */
  readonly rlsExcepted?: string;
}

const SCHEMAS: Readonly<Record<string, SchemaCatalogue>> = {
  app,
  auth,
  party,
  grants,
  crm,
  pgboss,
  migrations,
  assure,
};

/** Every schema's entries for `key`, checking that each names only its own schema. */
function merged<T>(pick: (catalogue: SchemaCatalogue) => Entries<T> | undefined): [string, T][] {
  return Object.entries(SCHEMAS).flatMap(([schema, catalogue]) =>
    (pick(catalogue) ?? []).map(([name, entry]): [string, T] => {
      if (!name.startsWith(`${schema}.`)) {
        throw new Error(`test/catalogue/${schema}.ts names ${name}, outside its schema.`);
      }
      return [name, entry];
    }),
  );
}

/** Each schema whose catalogue sets `pick`, with its reason. */
function schemasWith(pick: (catalogue: SchemaCatalogue) => string | undefined): [string, string][] {
  return Object.entries(SCHEMAS).flatMap(([schema, catalogue]) => {
    const reason = pick(catalogue);
    return reason === undefined ? [] : [[schema, reason] as [string, string]];
  });
}

export const EXECUTABLE_BY: ReadonlyMap<string, readonly (AppRole | SetRole)[]> = new Map(
  merged((catalogue) => catalogue.executableBy),
);

export const DEFINER_FUNCTIONS: ReadonlyMap<string, DefinerFunction> = new Map(
  merged((catalogue) => catalogue.definerFunctions),
);

export const NON_TENANT_TABLES: ReadonlyMap<string, string> = new Map(
  merged((catalogue) => catalogue.nonTenantTables),
);

export const TENANT_KEYED_BY_ID: ReadonlyMap<string, string> = new Map(
  merged((catalogue) => catalogue.tenantKeyedById),
);

export const AUDIT_TABLES: readonly string[] = Object.values(SCHEMAS).flatMap(
  (catalogue) => catalogue.auditTables ?? [],
);

export const OWN_SCHEMAS: ReadonlyMap<string, { schema: string; outside: readonly string[] }> =
  new Map(
    Object.entries(SCHEMAS).flatMap(([schema, { ownSchema }]) =>
      ownSchema ? [[ownSchema.role, { schema, outside: ownSchema.outside }] as const] : [],
    ),
  );

/** Schemas the table, policy and classification checks skip, each with its reason. */
export const EXCEPTED_SCHEMAS: ReadonlyMap<string, string> = new Map(
  schemasWith((catalogue) => catalogue.excepted),
);

/** Schemas the table and policy checks skip, but not the classification check. */
export const RLS_EXCEPTED_SCHEMAS: ReadonlyMap<string, string> = new Map(
  schemasWith((catalogue) => catalogue.rlsExcepted),
);

// The database as a whole.

/** Rights PUBLIC may hold, as "<privilege> on <object>", each with its reason. */
export const PUBLIC_RIGHTS: ReadonlyMap<string, string> = new Map([
  [
    'USAGE on schema public',
    "PostgreSQL's own grant on the public schema, which no migration uses. Remove this entry once the database privileges script revokes it.",
  ],
]);

/**
 * The one named exception (ADR 0025): pg_trgm's schema, made by the database
 * privileges script. Schema USAGE is its access control, since a managed
 * database may leave EXECUTE on its functions with PUBLIC, so PUBLIC may
 * execute them and app_api and app_worker must be able to.
 */
export const EXTENSION_SCHEMA = 'ext';
export const EXTENSION = 'pg_trgm';
export const EXTENSION_USERS: readonly AppRole[] = ['app_api', 'app_worker'];

/**
 * The other named exception: the database privileges script lets the
 * backup role (BACKUP_ROLE) read every schema, table and sequence migrator
 * creates, so that pg_dump reads what a migration adds (roles.sql). These
 * are the only default privileges approved, for migrator in every schema,
 * as "<privilege> on new <objects>".
 */
export const BACKUP_DEFAULTS: readonly string[] = [
  'USAGE on new schemas',
  'SELECT on new tables',
  'SELECT on new sequences',
];
