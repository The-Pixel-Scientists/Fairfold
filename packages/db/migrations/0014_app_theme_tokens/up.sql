-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0014, up: a funder's own design tokens are stored with its theme,
-- and app.public_tenant() also returns them, so theme.css can be built before
-- sign-in (ADR 0046). Null means the preset and brand colour are in use. The
-- domain package checks every token before saving and again on every build;
-- the table checks only that they are an object of at most 16 KB as text.

ALTER TABLE app.tenant_theme
  ADD COLUMN tokens jsonb
    CONSTRAINT tenant_theme_tokens_object CHECK (jsonb_typeof(tokens) = 'object')
    CONSTRAINT tenant_theme_tokens_size CHECK (octet_length(tokens::text) <= 16384);
GRANT INSERT (tokens), UPDATE (tokens) ON app.tenant_theme TO app_api;
GRANT SELECT (tokens) ON app.tenant_theme TO owner_app_public_tenant;

-- The function's result gains a column, which CREATE OR REPLACE cannot do,
-- so its owner drops it and creates it again from migration 0007's
-- definition (ADR 0023), then grants EXECUTE to the same roles. The owner
-- holds CREATE on the schema only for the replacement.
GRANT CREATE ON SCHEMA app TO owner_app_public_tenant;
SET LOCAL ROLE owner_app_public_tenant;

DROP FUNCTION app.public_tenant(text);

-- An active tenant's public face, by slug, with the default theme when it
-- has no theme row. The fallback mirrors defaultTheme in packages/domain. No
-- row for an unknown, suspended or malformed slug.
CREATE FUNCTION app.public_tenant(slug text)
  RETURNS TABLE (id uuid, name text, brand_colour text, preset text, has_logo boolean,
                 tokens jsonb)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT t.id, t.name, COALESCE(h.brand_colour, '#1b1d21'), COALESCE(h.preset, 'standard'),
         h.logo_type IS NOT NULL, h.tokens
    FROM app.tenant AS t
    LEFT JOIN app.tenant_theme AS h ON h.tenant_id = t.id
   WHERE t.slug = public_tenant.slug AND t.status = 'active';
END;

REVOKE ALL ON FUNCTION app.public_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_tenant(text) TO app_api, app_auth;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_public_tenant;
