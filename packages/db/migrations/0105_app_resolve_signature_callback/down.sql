-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0105, down: remove app.resolve_signature_callback() and every
-- right and policy its owner was given. The owner role stays: the roles
-- script, not a migration, creates and removes roles.

DROP FUNCTION app.resolve_signature_callback(bytea);
DROP POLICY resolve_signature_callback_select ON app.signature_connection;
DROP POLICY resolve_signature_callback_select ON app.tenant;
REVOKE SELECT (tenant_id, id, status, callback_reference_hash, callback_key_version)
    ON app.signature_connection FROM owner_app_resolve_signature_callback;
REVOKE SELECT (id, status) ON app.tenant FROM owner_app_resolve_signature_callback;
REVOKE USAGE ON SCHEMA app FROM owner_app_resolve_signature_callback;
