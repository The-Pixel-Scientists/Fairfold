-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0007, down: restore migration 0006's app.public_tenant(), which
-- falls back to #1f4bb8. It is replaced as its owner (ADR 0023), so its owner
-- and EXECUTE grants stay as they are, and the owner holds CREATE on the
-- schema only for the replacement.

GRANT CREATE ON SCHEMA app TO owner_app_public_tenant;
SET LOCAL ROLE owner_app_public_tenant;

-- An active tenant's public face, by slug, with the default theme
-- (defaultTheme in packages/domain) when it has no theme row. No row for an
-- unknown, suspended or malformed slug.
CREATE OR REPLACE FUNCTION app.public_tenant(slug text)
  RETURNS TABLE (id uuid, name text, brand_colour text, preset text, has_logo boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT t.id, t.name, COALESCE(h.brand_colour, '#1f4bb8'), COALESCE(h.preset, 'standard'),
         h.logo_type IS NOT NULL
    FROM app.tenant AS t
    LEFT JOIN app.tenant_theme AS h ON h.tenant_id = t.id
   WHERE t.slug = public_tenant.slug AND t.status = 'active';
END;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM owner_app_public_tenant;
