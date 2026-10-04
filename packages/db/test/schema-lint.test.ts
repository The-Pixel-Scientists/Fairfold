// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The schema lint against the migrated test database, connected as each app
// role, and a check that it really reports each kind of problem it looks for.

import { describe, expect, it } from 'vitest';

import { classification, type ClassificationRegistry } from '../classification.ts';
import { APP_ROLES, asMigratorRolledBack, withClient } from './connect.ts';
import { findSchemaProblems, hasTenantTerm, TENANT_TERM } from './schema-lint.ts';

describe('schema lint', () => {
  it.each(APP_ROLES)('finds no problems, connected as %s', async (role) => {
    const problems = await withClient(role, (client) => findSchemaProblems(client, classification));
    expect(problems).toEqual([]);
  });

  it('reports every kind of problem it checks for', async () => {
    const tenantLifetime = {
      sensitivity: 'internal',
      retention: { kind: 'tenant_lifetime' },
    } as const;
    // The migrated tables keep their own classification.
    const registry: ClassificationRegistry = {
      ...classification,
      'app.lint_good': {
        id: tenantLifetime,
        tenant_id: tenantLifetime,
        created_at: { sensitivity: 'internal', retention: { kind: 'fixed', days: 0, from: 'id' } },
      },
      'app.lint_for_all': {
        id: {
          sensitivity: 'internal',
          retention: { kind: 'tenant_policy', policy: ' ', minimumDays: 1.5 },
        },
      },
      'app.lint_policies': {
        id: tenantLifetime,
        tenant_id: tenantLifetime,
        note: tenantLifetime,
        good_id: tenantLifetime,
        parent_id: tenantLifetime,
      },
      'app.lint_gone': {
        note: { sensitivity: 'personal', retention: { kind: 'tenant_lifetime' } },
      },
    };

    const problems = await asMigratorRolledBack(async (client) => {
      await client.query(`
        CREATE TABLE app.lint_bare (id uuid PRIMARY KEY);
        CREATE RULE lint_rule AS ON DELETE TO app.lint_bare DO INSTEAD NOTHING;

        CREATE TABLE app.lint_for_all (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
        ALTER TABLE app.lint_for_all ENABLE ROW LEVEL SECURITY;
        CREATE POLICY everything ON app.lint_for_all FOR ALL
          USING (tenant_id = app.current_tenant_id());

        -- The last three columns share names with Object.prototype's own.
        CREATE TABLE app.lint_good (
          id uuid PRIMARY KEY,
          tenant_id uuid NOT NULL,
          created_at timestamptz NOT NULL,
          "constructor" text,
          "toString" text,
          "__proto__" text,
          UNIQUE (tenant_id, id)
        );
        SELECT app.enable_tenant_rls('app.lint_good');

        -- No app role may insert or delete (rule 4). INSERT is denied as it
        -- should be; each restrictive DELETE policy falls short.
        CREATE POLICY deny_insert ON app.lint_good AS RESTRICTIVE FOR INSERT
          TO app_api, app_worker, app_queue, app_auth WITH CHECK (false);
        CREATE POLICY some_roles ON app.lint_good AS RESTRICTIVE FOR DELETE
          TO app_api, app_worker USING (false);
        CREATE POLICY not_false ON app.lint_good AS RESTRICTIVE FOR DELETE
          TO app_api, app_worker, app_queue, app_auth USING (tenant_id IS NULL);

        -- Every command has a policy, but three are wrong; a fourth comes below.
        -- Only the first foreign key matches tenant_id to tenant_id (rule 6).
        CREATE TABLE app.lint_policies (
          id uuid PRIMARY KEY,
          tenant_id uuid NOT NULL,
          note text,
          good_id uuid,
          parent_id uuid,
          UNIQUE (tenant_id, id),
          FOREIGN KEY (tenant_id, good_id) REFERENCES app.lint_good (tenant_id, id),
          CONSTRAINT lint_swapped FOREIGN KEY (good_id, tenant_id)
            REFERENCES app.lint_good (tenant_id, id),
          CONSTRAINT lint_no_tenant FOREIGN KEY (parent_id) REFERENCES app.lint_good (id)
        );
        ALTER TABLE app.lint_policies ENABLE ROW LEVEL SECURITY;
        ALTER TABLE app.lint_policies FORCE ROW LEVEL SECURITY;
        CREATE POLICY widened ON app.lint_policies FOR SELECT
          USING (tenant_id = app.current_tenant_id() OR note = 'shared');
        CREATE POLICY anyone ON app.lint_policies FOR INSERT WITH CHECK (true);
        CREATE POLICY unchecked ON app.lint_policies FOR UPDATE TO app_api
          USING (tenant_id = app.current_tenant_id());
        CREATE POLICY narrowed ON app.lint_policies FOR DELETE
          USING (tenant_id = app.current_tenant_id() AND note IS NOT NULL);
        CREATE POLICY never ON app.lint_policies AS RESTRICTIVE FOR DELETE TO app_api, app_worker
          USING (false);

        -- So rule 4 has nothing to say about these three.
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.lint_bare, app.lint_for_all, app.lint_policies
          TO app_api;

        -- Rule 5: the tenant comes from another setting.
        CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
          LANGUAGE sql STABLE PARALLEL SAFE
          RETURN NULLIF(pg_catalog.current_setting('app.tenant', true), '')::uuid;

        CREATE VIEW app.lint_view AS SELECT id FROM app.lint_good;
        CREATE VIEW app.lint_invoker_view WITH (security_invoker = on)
          AS SELECT id FROM app.lint_good;
        CREATE MATERIALIZED VIEW app.lint_matview AS SELECT 1 AS one;

        GRANT TRUNCATE, REFERENCES, TRIGGER ON app.lint_good TO app_api;
        GRANT SELECT ON app.lint_good TO PUBLIC;
        GRANT UPDATE (created_at) ON app.lint_good TO PUBLIC;
        CREATE SEQUENCE app.lint_sequence;
        GRANT USAGE ON SEQUENCE app.lint_sequence TO PUBLIC;

        CREATE FUNCTION app.lint_definer() RETURNS integer
          LANGUAGE sql SECURITY DEFINER RETURN 1;
        GRANT EXECUTE ON FUNCTION app.lint_definer() TO PUBLIC;
        CREATE FUNCTION migrations.lint_open() RETURNS integer LANGUAGE sql RETURN 1;
        GRANT EXECUTE ON FUNCTION migrations.lint_open() TO PUBLIC;

        GRANT CREATE ON SCHEMA app TO app_worker;
        GRANT USAGE ON SCHEMA migrations TO app_api;
        DO $grant$
        BEGIN
          EXECUTE pg_catalog.format('GRANT CREATE ON DATABASE %I TO app_auth',
            pg_catalog.current_database());
          EXECUTE pg_catalog.format('GRANT TEMPORARY ON DATABASE %I TO app_queue',
            pg_catalog.current_database());
        END
        $grant$;
        CREATE PUBLICATION lint_publication;

        -- An = for uuid that means "not equal", found before pg_catalog's
        -- through a database-wide search_path. The policy below uses it,
        -- though it prints as a plain = under that search_path.
        CREATE OPERATOR public.= (LEFTARG = uuid, RIGHTARG = uuid, FUNCTION = pg_catalog.uuid_ne);
        DO $setting$
        BEGIN
          EXECUTE pg_catalog.format('ALTER DATABASE %I SET search_path = public, pg_catalog',
            pg_catalog.current_database());
        END
        $setting$;
        SET search_path = public, pg_catalog;
        CREATE POLICY shadowed ON app.lint_policies FOR SELECT
          USING (tenant_id = app.current_tenant_id());
      `);
      return findSchemaProblems(client, registry);
    });

    const allRoles = 'app_api, app_auth, app_queue, app_worker';
    expect(problems).toEqual(
      [
        'app.lint_bare does not enable row-level security.',
        'app.lint_bare does not force row-level security.',
        'app.lint_bare has no row-level security policy.',
        'app.lint_bare has no tenant_id uuid NOT NULL column and is not on the list of non-tenant tables.',
        'app.lint_bare.id is not classified in classification.ts.',
        "app.lint_bare has rewrite rule lint_rule. Rules run with the table owner's rights, so none is approved.",
        'app.lint_for_all does not force row-level security.',
        'app.lint_for_all has a FOR ALL policy. Write one policy per command.',
        'app.lint_for_all has no policy for SELECT.',
        'app.lint_for_all has no policy for INSERT.',
        'app.lint_for_all has no policy for UPDATE.',
        'app.lint_for_all has no policy for DELETE.',
        'app.lint_for_all.id names an empty retention policy.',
        'app.lint_for_all.id has a minimum of 1.5 days, not a whole number above 0.',
        'app.lint_for_all.tenant_id is not classified in classification.ts.',
        'app.lint_bare has no UNIQUE (tenant_id, id) constraint.',
        'app.lint_for_all has no UNIQUE (tenant_id, id) constraint.',
        'app.lint_good grants DELETE to no app role, and has no restrictive DELETE policy with USING (false) for every app role.',
        'app.lint_policies foreign key lint_no_tenant does not match its tenant_id to app.lint_good.tenant_id.',
        'app.lint_policies foreign key lint_swapped does not match its tenant_id to app.lint_good.tenant_id.',
        'app.current_tenant_id() is not defined as CURRENT_TENANT_ID_DEFINITION (ADR 0003, row-level security rule 5).',
        'app.lint_good.created_at keeps values for 0 days, not a whole number above 0.',
        'app.lint_good.created_at counts its retention from id, which is not a date column of app.lint_good.',
        'app.lint_good.__proto__ is not classified in classification.ts.',
        'app.lint_good.constructor is not classified in classification.ts.',
        'app.lint_good.toString is not classified in classification.ts.',
        `app.lint_policies policy widened (SELECT to public) does not have ${TENANT_TERM} as its USING expression or a top-level AND term of it.`,
        `app.lint_policies policy anyone (INSERT to public) does not have ${TENANT_TERM} as its WITH CHECK expression or a top-level AND term of it.`,
        'app.lint_policies policy unchecked (UPDATE to app_api) has no WITH CHECK expression.',
        `app.lint_policies policy shadowed (SELECT to public) does not have ${TENANT_TERM} as its USING expression or a top-level AND term of it.`,
        'Operator public.=(uuid,uuid) exists. A user-defined operator can stand in for a built-in one, so none is approved.',
        'search_path is set for every session in this database. Settings for every role are not approved.',
        'app.lint_view is a view without security_invoker.',
        'app.lint_matview is a materialized view, and none is approved.',
        'Role app_api holds REFERENCES on app.lint_good.',
        'Role app_api holds TRIGGER on app.lint_good.',
        'Role app_api holds TRUNCATE on app.lint_good.',
        'PUBLIC holds SELECT on app.lint_good.',
        'PUBLIC holds UPDATE on column app.lint_good.created_at.',
        'PUBLIC holds USAGE on app.lint_sequence.',
        'app.lint_definer() is SECURITY DEFINER, and no definer function is approved yet.',
        'PUBLIC can execute app.lint_definer().',
        `app.lint_definer() is executable by ${allRoles}; EXECUTABLE_BY allows no app role.`,
        'PUBLIC can execute migrations.lint_open().',
        `migrations.lint_open() is executable by ${allRoles}; EXECUTABLE_BY allows no app role.`,
        'Role app_worker can create objects in schema app.',
        'Role app_api can use the excepted schema migrations.',
        'Role app_auth can create schemas in this database.',
        'Role app_queue can create temporary tables in this database.',
        'Publication lint_publication exists. Logical replication ignores row-level security, so none is approved.',
        'classification.ts names app.lint_gone.note, which does not exist.',
      ].sort(),
    );
  });
});

describe('hasTenantTerm', () => {
  it.each([
    ['the tenant term alone', TENANT_TERM],
    ['the first AND term', `(${TENANT_TERM} AND (note IS NOT NULL))`],
    ['the last of three AND terms', `((a > 1) AND (b < 2) AND ${TENANT_TERM})`],
    ['an AND term beside a quoted literal', `((note = 'it''s'::text) AND ${TENANT_TERM})`],
  ])('accepts %s', (_, expression) => {
    expect(hasTenantTerm(expression)).toBe(true);
  });

  it.each([
    ['true', 'true'],
    ['an OR term', `(${TENANT_TERM} OR (note = 'shared'::text))`],
    ['an AND term under an OR', `((${TENANT_TERM} AND (a > 1)) OR (b < 2))`],
    ['NOT around the term', `(NOT ${TENANT_TERM})`],
    ['the term inside a literal', `(note = ' AND ${TENANT_TERM} AND '::text)`],
    ['another function', '(tenant_id = app.other_tenant_id())'],
  ])('refuses %s', (_, expression) => {
    expect(hasTenantTerm(expression)).toBe(false);
  });

  it('looks for the term given, for a table keyed by its own id', () => {
    const idTerm = '(id = app.current_tenant_id())';
    expect(hasTenantTerm(`(${idTerm} AND (a > 1))`, idTerm)).toBe(true);
    expect(hasTenantTerm(idTerm)).toBe(false);
  });
});
