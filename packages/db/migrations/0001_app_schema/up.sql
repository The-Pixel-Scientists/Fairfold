-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0001, up: the app schema and the tenant context (ADR 0003).
--
-- Tenant tables added by later migrations live in the app schema and call
-- app.enable_tenant_rls(), so every one of them gets the same reviewed
-- row-level security. The roles script has already taken CREATE on schemas
-- and EXECUTE on functions away from PUBLIC, including for functions that
-- migrator creates from now on, so this file only grants what the app roles
-- need.

CREATE SCHEMA app AUTHORIZATION migrator;

-- The tenant of the current transaction, or NULL when none is set.
--
-- packages/db sets the tenant with set_config('app.tenant_id', <id>, true),
-- which lasts only until the transaction ends. Once the setting has been
-- used on a connection, PostgreSQL reports it as an empty string rather than
-- NULL, so NULLIF turns that into NULL too. With no tenant, every tenant
-- policy matches no rows. A value that is not a uuid makes the cast, and so
-- the whole query, fail.
--
-- The body is SQL-standard (RETURN ...), so PostgreSQL resolves its names
-- once, here, rather than through each caller's search_path, and can inline
-- it into the policies that call it. It runs with the caller's rights, and
-- current_setting is safe to run in parallel workers, which receive the
-- leader's settings.
CREATE FUNCTION app.current_tenant_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  SECURITY INVOKER
  RETURN NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;

-- Turn on row-level security for a tenant table and add the standard tenant
-- policies (ADR 0003, row-level security rules 2, 3 and 5): one policy per
-- command, never FOR ALL, each matching only rows whose tenant_id is the
-- current tenant, so none at all when no tenant is set. The UPDATE policy
-- states WITH CHECK, so a row cannot be moved to another tenant.
--
-- The policies apply to every role. Grants decide which commands a role may
-- run on the table, and these policies decide which rows it reaches. FORCE
-- makes them apply to the table's owner, migrator, as well.
--
-- Only migrator runs this, from migrations: no app role is granted EXECUTE,
-- PUBLIC has none, and ALTER TABLE needs the table's owner anyway.
CREATE FUNCTION app.enable_tenant_rls(target regclass)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  table_name text;
BEGIN
  -- A query on one partition uses that partition's policies, not its
  -- parent's, so partitioned tables need a design of their own first.
  IF (SELECT c.relkind FROM pg_catalog.pg_class c WHERE c.oid = target) = 'p' THEN
    RAISE EXCEPTION 'Table % is partitioned, and app.enable_tenant_rls() does not handle partitioned tables yet: each partition would need its own policies.', target;
  END IF;

  -- Accept only an ordinary table with a tenant_id uuid NOT NULL column, and
  -- take its schema-qualified, quoted name.
  SELECT pg_catalog.format('%I.%I', n.nspname, c.relname)
    INTO table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE c.oid = target
     AND c.relkind = 'r'
     AND a.attname = 'tenant_id'
     AND a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
     AND a.attnotnull
     AND NOT a.attisdropped;
  IF table_name IS NULL THEN
    RAISE EXCEPTION 'Table % needs a tenant_id uuid NOT NULL column before tenant row-level security can be enabled.', target;
  END IF;

  EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE pg_catalog.format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', table_name);

  EXECUTE pg_catalog.format(
    'CREATE POLICY tenant_select ON %s AS PERMISSIVE FOR SELECT TO PUBLIC '
      'USING (tenant_id = app.current_tenant_id())',
    table_name);
  EXECUTE pg_catalog.format(
    'CREATE POLICY tenant_insert ON %s AS PERMISSIVE FOR INSERT TO PUBLIC '
      'WITH CHECK (tenant_id = app.current_tenant_id())',
    table_name);
  EXECUTE pg_catalog.format(
    'CREATE POLICY tenant_update ON %s AS PERMISSIVE FOR UPDATE TO PUBLIC '
      'USING (tenant_id = app.current_tenant_id()) '
      'WITH CHECK (tenant_id = app.current_tenant_id())',
    table_name);
  EXECUTE pg_catalog.format(
    'CREATE POLICY tenant_delete ON %s AS PERMISSIVE FOR DELETE TO PUBLIC '
      'USING (tenant_id = app.current_tenant_id())',
    table_name);
END
$function$;

-- The app roles may look up names in the app schema and read the current
-- tenant, which every tenant policy calls. They own nothing and get nothing
-- else here: grants on tables come table by table in later migrations.
GRANT USAGE ON SCHEMA app TO app_api, app_worker, app_auth, app_queue;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_api, app_worker, app_auth, app_queue;
