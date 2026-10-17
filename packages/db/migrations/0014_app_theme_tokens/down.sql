-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0014, down: restore migration 0007's app.public_tenant(), which
-- falls back to ink, #1b1d21, and drop the tokens column with its checks and
-- grants. Stored tokens cannot come back, so this refuses while any theme
-- has them (ADR 0003).
--
-- Row-level security hides every tenant's rows from migrator, so a query
-- would find none. Validating a new check reads every row whatever the
-- policies, so the refusal adds one; dropping the column drops it again.
DO $refuse$
BEGIN
  ALTER TABLE app.tenant_theme
    ADD CONSTRAINT tenant_theme_tokens_unset CHECK (tokens IS NULL);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0014 cannot be rolled back while a theme has tokens: dropping the column would lose them.'
    USING HINT = 'Restore the database backup taken before migration 0014 instead, as ADR 0003 sets out.';
END
$refuse$;

-- The owner drops the function and creates 0007's again (ADR 0023), with
-- the same EXECUTE grants, holding CREATE on the schema only for this.
GRANT CREATE ON SCHEMA app TO owner_app_public_tenant;
SET LOCAL ROLE owner_app_public_tenant;

DROP FUNCTION app.public_tenant(text);

-- An active tenant's public face, by slug, with the default theme when it
-- has no theme row. The fallback mirrors defaultTheme in packages/domain. No
-- row for an unknown, suspended or malformed slug.
CREATE FUNCTION app.public_tenant(slug text)
  RETURNS TABLE (id uuid, name text, brand_colour text, preset text, has_logo boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT t.id, t.name, COALESCE(h.brand_colour, '#1b1d21'), COALESCE(h.preset, 'standard'),
         h.logo_type IS NOT NULL
    FROM app.tenant AS t
    LEFT JOIN app.tenant_theme AS h ON h.tenant_id = t.id
   WHERE t.slug = public_tenant.slug AND t.status = 'active';
END;

REVOKE ALL ON FUNCTION app.public_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_tenant(text) TO app_api, app_auth;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_public_tenant;

-- Its column grants to app_api and the owner go with it.
ALTER TABLE app.tenant_theme DROP COLUMN tokens;
