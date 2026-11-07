// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rights checks that ADR 0003 rule 4 and its role table add to the
// schema lint: grant options, rights outside a role's own schema, default
// privileges, schema grants to PUBLIC, rights on the audit tables, the
// approved definer functions and their owners, and pg_trgm's schema. The
// schema-lint test covers the rest, and runs these against the migrated
// database.

import { describe, expect, it } from 'vitest';

import { classification } from '../classification.ts';
import { asMigratorRolledBack } from './connect.ts';
import { findPrivilegeProblems } from './privilege-lint.ts';
import { EXCEPTED_SCHEMAS, findSchemaProblems } from './schema-lint.ts';

describe('privilege lint', () => {
  it('reports grant options, rights outside own schemas, default privileges and PUBLIC schema grants', async () => {
    const problems = await asMigratorRolledBack(async (client) => {
      await client.query(`
        CREATE TABLE app.lint_rights (id uuid PRIMARY KEY);
        GRANT SELECT ON app.lint_rights TO app_api WITH GRANT OPTION;
        GRANT UPDATE (id) ON app.lint_rights TO app_worker WITH GRANT OPTION;
        GRANT SELECT ON app.lint_rights TO app_auth;
        GRANT INSERT (id) ON app.lint_rights TO app_queue;
        GRANT USAGE ON SCHEMA app TO PUBLIC;
        ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA app
          GRANT SELECT ON TABLES TO app_worker;
        ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA app
          GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
        ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA app
          GRANT SELECT ON TABLES TO backup_reader;
        ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT INSERT ON TABLES TO backup_reader;
      `);
      return findPrivilegeProblems(client, [...EXCEPTED_SCHEMAS.keys()]);
    });

    expect(problems.sort()).toEqual(
      [
        'Role app_api holds SELECT on app.lint_rights with grant option.',
        'Role app_worker holds UPDATE on column app.lint_rights.id with grant option.',
        'Role app_auth holds SELECT on app.lint_rights, outside its own schema auth.',
        'Role app_queue holds INSERT on column app.lint_rights.id, outside its own schema pgboss.',
        'PUBLIC holds USAGE on schema app.',
        'Default privileges for role migrator in schema app grant SELECT on new tables to app_worker.',
        'Default privileges for role migrator in schema app grant EXECUTE on new functions to PUBLIC.',
        // backup_reader's exception covers only its reads, in every schema.
        'Default privileges for role migrator in schema app grant SELECT on new tables to backup_reader.',
        'Default privileges for role migrator grant INSERT on new tables to backup_reader.',
      ].sort(),
    );
  });

  it('reports rights on an audit table beyond INSERT and SELECT, INSERT on the columns the database sets, and app_operator rights', async () => {
    const problems = await asMigratorRolledBack(async (client) => {
      await client.query(`
        GRANT UPDATE (changes) ON app.audit_event TO app_api;
        GRANT DELETE, INSERT (occurred_at) ON app.audit_event TO app_worker;
        GRANT INSERT ON app.audit_event TO app_api;
        GRANT UPDATE (action), INSERT (retain_until) ON app.audit_event TO app_operator;
        GRANT TRUNCATE ON app.tenant_module TO app_operator;
        GRANT EXECUTE ON FUNCTION app.tenant_ids() TO app_operator;
      `);
      return findPrivilegeProblems(client, [...EXCEPTED_SCHEMAS.keys()]);
    });

    expect(problems.sort()).toEqual(
      [
        'Role app_api holds UPDATE on the audit table app.audit_event.',
        'Role app_api can insert app.audit_event.occurred_at, which the database sets.',
        'Role app_api can insert app.audit_event.retain_until, which the database sets.',
        'Role app_api can insert app.audit_event.actor_member_kind, which the database sets.',
        'Role app_worker holds DELETE on the audit table app.audit_event.',
        'Role app_worker can insert app.audit_event.occurred_at, which the database sets.',
        // app_operator, which app_worker may SET ROLE to, is checked as well.
        'Role app_operator holds UPDATE on the audit table app.audit_event.',
        'Role app_operator can insert app.audit_event.retain_until, which the database sets.',
        'Role app_operator holds TRUNCATE on app.tenant_module.',
        'app.tenant_ids() is executable by app_operator, app_worker; EXECUTABLE_BY allows app_worker.',
      ].sort(),
    );
  });

  it('reports a definer function without its pinned search_path, and an owner with unlisted rights, objects or policies', async () => {
    const owner = 'Function owner owner_auth_session_context';
    const problems = await asMigratorRolledBack(async (client) => {
      await client.query(`
        GRANT CREATE ON SCHEMA auth TO owner_auth_session_context;
        SET LOCAL ROLE owner_auth_session_context;
        ALTER FUNCTION auth.session_context(bytea) RESET search_path;
        CREATE FUNCTION auth.lint_owned() RETURNS integer LANGUAGE sql RETURN 1;
        REVOKE EXECUTE ON FUNCTION auth.lint_owned() FROM PUBLIC;
        RESET ROLE;
        GRANT SELECT (id) ON auth.account TO owner_auth_session_context;
        REVOKE SELECT (status) ON auth."user" FROM owner_auth_session_context;
        CREATE POLICY lint_extra ON auth.account FOR SELECT TO owner_auth_session_context
          USING (true);
      `);
      return findPrivilegeProblems(client, [...EXCEPTED_SCHEMAS.keys()]);
    });

    expect(problems.sort()).toEqual(
      [
        'auth.session_context(bytea) does not set only search_path=pg_catalog, pg_temp.',
        `${owner} owns function auth.lint_owned(), which is not approved.`,
        `${owner} holds CREATE on schema auth, which is not approved.`,
        `${owner} holds SELECT on column auth.account.id, which is not approved.`,
        `${owner} lacks SELECT on column auth.user.status, which DEFINER_FUNCTIONS lists.`,
        `${owner} is named in auth.account policy lint_extra, which is not approved.`,
      ].sort(),
    );
  });

  // The database privileges script installs pg_trgm in schema ext, which
  // belongs to the superuser, before any migration. Only that owner can
  // change the schema, so the checks that report anything else in it are
  // tested as the superuser in packages/db/scripts/roles.db.test.ts.
  it('accepts pg_trgm in schema ext as the database privileges script installs it (ADR 0025)', async () => {
    const { extension, problems } = await asMigratorRolledBack(async (client) => {
      const { rows } = await client.query<{ schema: string }>(
        `SELECT extnamespace::regnamespace::text AS schema
           FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm'`,
      );
      return {
        extension: rows,
        problems: await findSchemaProblems(client, classification),
      };
    });
    expect(extension).toEqual([{ schema: 'ext' }]);
    expect(problems).toEqual([]);
  });
});
