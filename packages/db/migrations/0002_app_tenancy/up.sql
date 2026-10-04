-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0002, up: tenants, memberships, module switches, themes and
-- configuration versions (ADR 0003, ADR 0016, ADR 0019).
--
-- Every table is a tenant table under forced row-level security. Grants go
-- to app_api alone, column by column where it may write only some columns,
-- and every command no app role may run has a restrictive false policy
-- (ADR 0003 rule 4). Ids, created_at and updated_at come from the database.
-- Actors are memberships of the same tenant. The lists in the checks on
-- roles, modules, presets, logo types, logo size and slugs copy those in
-- packages/domain/src/platform, and a test keeps the two in step.

-- Add ADR 0003 rule 4's restrictive policy for one command, so no app role
-- can run it on the table whatever its grants. Like app.enable_tenant_rls(),
-- only migrator runs it, from migrations.
CREATE FUNCTION app.deny_command(target regclass, command text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  table_name text;
BEGIN
  IF command IS NULL OR command NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Command % is not SELECT, INSERT, UPDATE or DELETE.', command;
  END IF;
  SELECT pg_catalog.format('%I.%I', n.nspname, c.relname)
    INTO table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE c.oid = target AND c.relkind = 'r';
  IF table_name IS NULL THEN
    RAISE EXCEPTION '% is not an ordinary table.', target;
  END IF;

  EXECUTE pg_catalog.format(
    'CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s '
      'TO app_api, app_worker, app_queue, app_auth %s (false)',
    'deny_' || pg_catalog.lower(command), table_name, command,
    CASE command WHEN 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END);
END
$function$;

-- Keep updated_at current, so no app role needs to write it.
CREATE FUNCTION app.set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

-- Each row is a tenant, so the tenant is its id (ADR 0003's allowlist), and
-- the policies are written out here rather than by app.enable_tenant_rls().
-- Tenants are created by the operator (ADR 0019), never by an app role.
CREATE TABLE app.tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CONSTRAINT tenant_slug_format CHECK (slug ~ '^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$')
    CONSTRAINT tenant_slug_not_reserved CHECK (slug <> ALL (ARRAY[
      'api', 'assets', 'auth', 'console', 'dev', 'health', 'how-applying-works', 'portal',
      'public'])),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  timezone text NOT NULL DEFAULT 'Europe/London' CHECK (timezone ~ '^[A-Za-z][A-Za-z0-9/_+-]{0,63}$'),
  fiscal_year_start_month smallint NOT NULL DEFAULT 4
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON app.tenant AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (id = app.current_tenant_id());
CREATE POLICY tenant_insert ON app.tenant AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (id = app.current_tenant_id());
CREATE POLICY tenant_update ON app.tenant AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (id = app.current_tenant_id()) WITH CHECK (id = app.current_tenant_id());
CREATE POLICY tenant_delete ON app.tenant AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (id = app.current_tenant_id());
SELECT app.deny_command('app.tenant', 'INSERT');
SELECT app.deny_command('app.tenant', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.tenant
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, UPDATE (name, timezone, fiscal_year_start_month) ON app.tenant TO app_api;

-- A user's place in a tenant. user_id gains its foreign key to auth.user in
-- migration 0004. created_by and updated_by are null where the operator or
-- the system acted. Members are removed by status, never deleted.
CREATE TABLE app.membership (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  roles text[] NOT NULL CHECK (
    array_ndims(roles) = 1 AND cardinality(roles) > 0
    AND roles <@ ARRAY['tenant_admin', 'programme_manager', 'reviewer', 'applicant']),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.membership');
SELECT app.deny_command('app.membership', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.membership
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, user_id, roles, created_by, updated_by),
      UPDATE (roles, status, updated_by)
   ON app.membership TO app_api;

-- Which switchable modules a tenant uses. A module without a row is on.
CREATE TABLE app.tenant_module (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL CHECK (module IN ('grants')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, module),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.tenant_module');
SELECT app.deny_command('app.tenant_module', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.tenant_module
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, module, enabled, updated_by),
      UPDATE (enabled, updated_by)
   ON app.tenant_module TO app_api;

-- A tenant's look (ADR 0019), at most one row per tenant. The domain package
-- checks contrast and reads the logo's type from its bytes before saving.
CREATE TABLE app.tenant_theme (
  tenant_id uuid NOT NULL UNIQUE REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_colour text NOT NULL CHECK (brand_colour ~ '^#[0-9a-f]{6}$'),
  preset text NOT NULL CHECK (preset IN ('standard', 'rounded', 'square')),
  logo bytea CHECK (octet_length(logo) BETWEEN 1 AND 204800),
  logo_type text CHECK (logo_type IN ('image/png', 'image/webp')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK ((logo IS NULL) = (logo_type IS NULL)),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.tenant_theme');
SELECT app.deny_command('app.tenant_theme', 'DELETE');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.tenant_theme
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT,
      INSERT (tenant_id, brand_colour, preset, logo, logo_type, updated_by),
      UPDATE (brand_colour, preset, logo, logo_type, updated_by)
   ON app.tenant_theme TO app_api;

-- One row per change to a programme, stage, rubric, form, template, theme or
-- module switch (architecture rule 10). Append-only: app_api may insert and
-- read, never change or remove.
CREATE TABLE app.config_version (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z]+\.[a-z_]+$'),
  entity_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  author_id uuid NOT NULL,
  diff jsonb NOT NULL CHECK (jsonb_typeof(diff) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entity_type, entity_id, version),
  FOREIGN KEY (tenant_id, author_id) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.config_version');
SELECT app.deny_command('app.config_version', 'UPDATE');
SELECT app.deny_command('app.config_version', 'DELETE');
GRANT SELECT, INSERT (tenant_id, entity_type, entity_id, version, author_id, diff)
   ON app.config_version TO app_api;
