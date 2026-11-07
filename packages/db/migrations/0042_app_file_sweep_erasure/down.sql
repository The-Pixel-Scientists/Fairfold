-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0042, down: no file sweep delete or file erasure. The owner
-- roles stay: the roles script, not a migration, creates and removes roles.
-- Rows already deleted or erased stay so.

DROP FUNCTION app.erase_file(uuid, uuid);
REVOKE SELECT (tenant_id, id, status) ON party.party FROM owner_app_erase_file;
REVOKE SELECT (tenant_id, id, kind, permission, status, filters)
    ON app.job_request FROM owner_app_erase_file;
REVOKE SELECT (tenant_id, id, erased_at), UPDATE (erased_at) ON app.file FROM owner_app_erase_file;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_erase_file;
REVOKE USAGE ON SCHEMA app, party FROM owner_app_erase_file;

DROP FUNCTION app.delete_swept_file(uuid);
DROP POLICY sweep_delete ON app.file;
REVOKE SELECT (tenant_id, id, scan_state, scanned_at, linked_at, released_at), DELETE
    ON app.file FROM owner_app_delete_swept_file;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_delete_swept_file;
REVOKE USAGE ON SCHEMA app FROM owner_app_delete_swept_file;
