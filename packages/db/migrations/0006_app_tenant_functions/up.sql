-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0006, up: the approved definer functions for public tenant
-- pages, tenant creation and a session's memberships (ADR 0003, ADR 0019),
-- a backstop check on tenant names, and app_worker's insert into the
-- audit log for the operator's tenant events.
--
-- Each function is owned by its own NOLOGIN role (roles script, version 3),
-- which holds only the columns the function reads or writes and is named in
-- one policy on each table it touches. No function sets a tenant, so an
-- anonymous request never runs with one. Each is handed to its owner as
-- ADR 0023 describes: grants first, then CREATE on the schema only for the
-- handover.

-- The backstop for any writer that skips tenantNameSchema in
-- packages/domain: 1 to 100 characters, not blank, and no C0 or C1 control,
-- zero-width, bidi control, line or paragraph separator or byte order mark.
ALTER TABLE app.tenant DROP CONSTRAINT tenant_name_check;
ALTER TABLE app.tenant ADD CONSTRAINT tenant_name_check CHECK (
  char_length(name) BETWEEN 1 AND 100
  AND btrim(name) <> ''
  AND name !~ '[\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2064\u2066-\u2069\ufeff]');

-- An active tenant's public face, by slug, with the default theme
-- (defaultTheme in packages/domain) when it has no theme row. No row for an
-- unknown, suspended or malformed slug.
CREATE FUNCTION app.public_tenant(slug text)
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

GRANT USAGE ON SCHEMA app TO owner_app_public_tenant;
GRANT SELECT (id, slug, name, status) ON app.tenant TO owner_app_public_tenant;
GRANT SELECT (tenant_id, brand_colour, preset, logo_type) ON app.tenant_theme
   TO owner_app_public_tenant;
CREATE POLICY public_tenant_select ON app.tenant FOR SELECT
  TO owner_app_public_tenant USING (true);
CREATE POLICY public_tenant_select ON app.tenant_theme FOR SELECT
  TO owner_app_public_tenant USING (true);

REVOKE ALL ON FUNCTION app.public_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_tenant(text) TO app_api, app_auth;
GRANT CREATE ON SCHEMA app TO owner_app_public_tenant;
ALTER FUNCTION app.public_tenant(text) OWNER TO owner_app_public_tenant;
REVOKE CREATE ON SCHEMA app FROM owner_app_public_tenant;

-- An active tenant's logo and its checked type, by slug. No row for an
-- unknown, suspended or malformed slug, or a tenant without a logo.
CREATE FUNCTION app.public_tenant_logo(slug text)
  RETURNS TABLE (logo bytea, logo_type text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT h.logo, h.logo_type
    FROM app.tenant AS t
    JOIN app.tenant_theme AS h ON h.tenant_id = t.id
   WHERE t.slug = public_tenant_logo.slug AND t.status = 'active' AND h.logo IS NOT NULL;
END;

GRANT USAGE ON SCHEMA app TO owner_app_public_tenant_logo;
GRANT SELECT (id, slug, status) ON app.tenant TO owner_app_public_tenant_logo;
GRANT SELECT (tenant_id, logo, logo_type) ON app.tenant_theme TO owner_app_public_tenant_logo;
CREATE POLICY public_tenant_logo_select ON app.tenant FOR SELECT
  TO owner_app_public_tenant_logo USING (true);
CREATE POLICY public_tenant_logo_select ON app.tenant_theme FOR SELECT
  TO owner_app_public_tenant_logo USING (true);

REVOKE ALL ON FUNCTION app.public_tenant_logo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_tenant_logo(text) TO app_api;
GRANT CREATE ON SCHEMA app TO owner_app_public_tenant_logo;
ALTER FUNCTION app.public_tenant_logo(text) OWNER TO owner_app_public_tenant_logo;
REVOKE CREATE ON SCHEMA app FROM owner_app_public_tenant_logo;

-- A new tenant, for the operator command alone (ADR 0019). The table's
-- checks refuse a bad, reserved or taken slug and a bad name. The id is made
-- here rather than returned by the insert, so the owner needs no SELECT.
CREATE FUNCTION app.create_tenant(slug text, name text)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  new_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO app.tenant (id, slug, name) VALUES (new_id, create_tenant.slug, create_tenant.name);
  RETURN new_id;
END
$function$;

GRANT USAGE ON SCHEMA app TO owner_app_create_tenant;
GRANT INSERT (id, slug, name) ON app.tenant TO owner_app_create_tenant;
CREATE POLICY create_tenant_insert ON app.tenant FOR INSERT
  TO owner_app_create_tenant WITH CHECK (true);

REVOKE ALL ON FUNCTION app.create_tenant(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_tenant(text, text) TO app_worker;
GRANT CREATE ON SCHEMA app TO owner_app_create_tenant;
ALTER FUNCTION app.create_tenant(text, text) OWNER TO owner_app_create_tenant;
REVOKE CREATE ON SCHEMA app FROM owner_app_create_tenant;

-- The operator command records the new tenant's audit event as app_worker,
-- with that tenant set. The retention trigger runs with the inserting role's
-- rights, so app_worker also reads the tenant's retention settings, as
-- app_api does.
GRANT INSERT (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id, changes)
   ON app.audit_event TO app_worker;
GRANT SELECT ON app.retention_policy TO app_worker;

-- The active memberships, in active tenants, of the user of a live session
-- that has finished MFA, for switching tenant (ADR 0019). The session rules are
-- auth.session_context()'s: not revoked, its user active, and inside its
-- app's idle and absolute timeouts and Better Auth's expiry. A session
-- waiting for MFA gets nothing. No row for any other hash.
CREATE FUNCTION auth.session_memberships(token_hash bytea)
  RETURNS TABLE (membership_id uuid, tenant_id uuid, slug text, name text, roles text[])
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT m.id, t.id, t.slug, t.name, m.roles
    FROM auth.session AS s
    JOIN auth."user" AS u ON u.id = s.user_id
    JOIN (VALUES ('console', interval '30 minutes', interval '12 hours'),
                 ('portal', interval '60 minutes', interval '24 hours'))
      AS a (app, idle, absolute) ON a.app = s.app
    JOIN app.membership AS m ON m.user_id = s.user_id
    JOIN app.tenant AS t ON t.id = m.tenant_id
   WHERE s.token_hash = session_memberships.token_hash
     AND s.revoked_at IS NULL
     AND s.mfa_state IN ('complete', 'not_required')
     AND u.status = 'active'
     AND LEAST(s.expires_at, s.created_at + a.absolute, s.last_seen_at + a.idle) > pg_catalog.now()
     AND m.status = 'active'
     AND t.status = 'active'
   ORDER BY t.name, t.id;
END;

GRANT USAGE ON SCHEMA auth, app TO owner_auth_session_memberships;
GRANT SELECT (token_hash, user_id, app, mfa_state, expires_at, created_at, last_seen_at, revoked_at)
   ON auth.session TO owner_auth_session_memberships;
GRANT SELECT (id, status) ON auth."user" TO owner_auth_session_memberships;
GRANT SELECT (id, tenant_id, user_id, roles, status) ON app.membership
   TO owner_auth_session_memberships;
GRANT SELECT (id, slug, name, status) ON app.tenant TO owner_auth_session_memberships;
CREATE POLICY session_memberships_select ON auth.session FOR SELECT
  TO owner_auth_session_memberships USING (true);
CREATE POLICY session_memberships_select ON auth."user" FOR SELECT
  TO owner_auth_session_memberships USING (true);
CREATE POLICY session_memberships_select ON app.membership FOR SELECT
  TO owner_auth_session_memberships USING (true);
CREATE POLICY session_memberships_select ON app.tenant FOR SELECT
  TO owner_auth_session_memberships USING (true);

REVOKE ALL ON FUNCTION auth.session_memberships(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.session_memberships(bytea) TO app_api;
GRANT CREATE ON SCHEMA auth TO owner_auth_session_memberships;
ALTER FUNCTION auth.session_memberships(bytea) OWNER TO owner_auth_session_memberships;
REVOKE CREATE ON SCHEMA auth FROM owner_auth_session_memberships;
