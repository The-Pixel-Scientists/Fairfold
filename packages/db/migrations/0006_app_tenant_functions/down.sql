-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0006, down: remove the tenant and session membership functions,
-- their owners' grants and policies, app_worker's audit insert, and the
-- tenant name backstop. migrator owns both schemas, so it may drop the
-- functions whoever owns them (ADR 0023).

DROP FUNCTION auth.session_memberships(bytea);
DROP POLICY session_memberships_select ON app.tenant;
DROP POLICY session_memberships_select ON app.membership;
DROP POLICY session_memberships_select ON auth."user";
DROP POLICY session_memberships_select ON auth.session;
REVOKE SELECT (id, slug, name, status) ON app.tenant FROM owner_auth_session_memberships;
REVOKE SELECT (id, tenant_id, user_id, roles, status) ON app.membership
  FROM owner_auth_session_memberships;
REVOKE SELECT (id, status) ON auth."user" FROM owner_auth_session_memberships;
REVOKE SELECT (token_hash, user_id, app, mfa_state, expires_at, created_at, last_seen_at, revoked_at)
  ON auth.session FROM owner_auth_session_memberships;
REVOKE USAGE ON SCHEMA auth, app FROM owner_auth_session_memberships;

REVOKE SELECT ON app.retention_policy FROM app_worker;
REVOKE INSERT (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id, changes)
  ON app.audit_event FROM app_worker;

DROP FUNCTION app.create_tenant(text, text);
DROP POLICY create_tenant_insert ON app.tenant;
REVOKE INSERT (id, slug, name) ON app.tenant FROM owner_app_create_tenant;
REVOKE USAGE ON SCHEMA app FROM owner_app_create_tenant;

DROP FUNCTION app.public_tenant_logo(text);
DROP POLICY public_tenant_logo_select ON app.tenant_theme;
DROP POLICY public_tenant_logo_select ON app.tenant;
REVOKE SELECT (tenant_id, logo, logo_type) ON app.tenant_theme FROM owner_app_public_tenant_logo;
REVOKE SELECT (id, slug, status) ON app.tenant FROM owner_app_public_tenant_logo;
REVOKE USAGE ON SCHEMA app FROM owner_app_public_tenant_logo;

DROP FUNCTION app.public_tenant(text);
DROP POLICY public_tenant_select ON app.tenant_theme;
DROP POLICY public_tenant_select ON app.tenant;
REVOKE SELECT (tenant_id, brand_colour, preset, logo_type) ON app.tenant_theme
  FROM owner_app_public_tenant;
REVOKE SELECT (id, slug, name, status) ON app.tenant FROM owner_app_public_tenant;
REVOKE USAGE ON SCHEMA app FROM owner_app_public_tenant;

ALTER TABLE app.tenant DROP CONSTRAINT tenant_name_check;
ALTER TABLE app.tenant ADD CONSTRAINT tenant_name_check
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
