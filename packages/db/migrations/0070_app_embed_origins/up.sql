-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0070, up: the origins each tenant allows to frame its embeds,
-- and app.embed_origins(slug), the approved definer function that reads them
-- with no tenant set (S12-48, ADR 0035).
--
-- An origin is added or removed, never changed. app_api writes the
-- platform.embed_origins config version and the audit event in the same
-- transaction (rules 4 and 10). The pattern and the cap of 20 copy
-- embedOriginPattern and MAX_EMBED_ORIGINS in packages/domain.

CREATE TABLE app.embed_origin (
  tenant_id uuid NOT NULL REFERENCES app.tenant (id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin text NOT NULL
    CONSTRAINT embed_origin_length CHECK (char_length(origin) <= 267)
    CONSTRAINT embed_origin_format CHECK (origin ~ '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[1-9][0-9]{0,4})?$')
    CONSTRAINT embed_origin_port CHECK (
      COALESCE(substring(origin FROM ':([0-9]{1,5})$')::integer, 443) <= 65535),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT embed_origin_once UNIQUE (tenant_id, origin),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app.membership (tenant_id, id) ON DELETE RESTRICT
);
SELECT app.enable_tenant_rls('app.embed_origin');
SELECT app.deny_command('app.embed_origin', 'UPDATE');
CREATE TRIGGER set_created_at BEFORE INSERT ON app.embed_origin
  FOR EACH ROW EXECUTE FUNCTION app.set_created_at();

-- At most 20 origins per tenant. The lock makes concurrent inserts for one
-- tenant take turns, so under read committed each counts the others' rows.
CREATE FUNCTION app.limit_embed_origins()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('app.embed_origin'), pg_catalog.hashtext(NEW.tenant_id::text));
  IF (SELECT pg_catalog.count(*) FROM app.embed_origin AS o
       WHERE o.tenant_id = NEW.tenant_id) >= 20 THEN
    RAISE EXCEPTION 'A tenant lists at most 20 embedding origins.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER limit_embed_origins BEFORE INSERT ON app.embed_origin
  FOR EACH ROW EXECUTE FUNCTION app.limit_embed_origins();

GRANT SELECT, INSERT (tenant_id, origin, created_by), DELETE ON app.embed_origin TO app_api;

-- An active tenant's allowed origins, by slug, when a module that offers
-- embeds (in v1, forms) is switched on by an explicit row (ADR 0024).
-- Nothing for an unknown, suspended or switched-off tenant, and never a
-- tenant id. The slug is compared exactly, nothing is raised on caller input,
-- and no tenant is set. Reading it is not a sensitive read, so it writes no
-- audit event.
CREATE FUNCTION app.embed_origins(slug text)
  RETURNS TABLE (origin text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT o.origin
    FROM app.tenant AS t
    JOIN app.tenant_module AS m ON m.tenant_id = t.id
    JOIN app.embed_origin AS o ON o.tenant_id = t.id
   WHERE t.slug = embed_origins.slug AND t.status = 'active'
     AND m.module = 'forms' AND m.enabled
   ORDER BY o.origin;
END;

GRANT USAGE ON SCHEMA app TO owner_app_embed_origins;
GRANT SELECT (id, slug, status) ON app.tenant TO owner_app_embed_origins;
GRANT SELECT (tenant_id, module, enabled) ON app.tenant_module TO owner_app_embed_origins;
GRANT SELECT (tenant_id, origin) ON app.embed_origin TO owner_app_embed_origins;
CREATE POLICY embed_origins_select ON app.tenant FOR SELECT
  TO owner_app_embed_origins USING (true);
CREATE POLICY embed_origins_select ON app.tenant_module FOR SELECT
  TO owner_app_embed_origins USING (true);
CREATE POLICY embed_origins_select ON app.embed_origin FOR SELECT
  TO owner_app_embed_origins USING (true);

REVOKE ALL ON FUNCTION app.embed_origins(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.embed_origins(text) TO app_api;
GRANT CREATE ON SCHEMA app TO owner_app_embed_origins;
ALTER FUNCTION app.embed_origins(text) OWNER TO owner_app_embed_origins;
REVOKE CREATE ON SCHEMA app FROM owner_app_embed_origins;
