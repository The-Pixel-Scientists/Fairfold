// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rights checks that ADR 0003 rule 4 and its role table add to the
// schema lint: grant options, rights outside a role's own schema, default
// privileges and schema grants to PUBLIC. The schema-lint test covers the
// rest, and runs these against the migrated database.

import { describe, expect, it } from 'vitest';

import { asMigratorRolledBack } from './connect.ts';
import { findPrivilegeProblems } from './privilege-lint.ts';
import { EXCEPTED_SCHEMAS } from './schema-lint.ts';

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
      ].sort(),
    );
  });
});
