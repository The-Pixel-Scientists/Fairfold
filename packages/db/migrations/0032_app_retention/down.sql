-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0032, down: drop app.apply_retention() and its owner's rights,
-- and make app.retention_policy read-only for app_api again, as 0003 left
-- it.
--
-- Settings admins wrote stay. This migration adds no policy id, so every
-- row is an audit setting that 0003's checks admit, and this deletes none.
-- owner_app_apply_retention stays: the roles script creates it, never a
-- migration (ADR 0003). The function goes first; migrator owns the schema,
-- so it may drop it (ADR 0023).

DROP FUNCTION app.apply_retention(text);

REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_apply_retention;
REVOKE USAGE ON SCHEMA app FROM owner_app_apply_retention;

REVOKE INSERT (tenant_id, policy, days, created_by, updated_by), UPDATE (days, updated_by)
    ON app.retention_policy FROM app_api;
SELECT app.deny_command('app.retention_policy', 'INSERT');
SELECT app.deny_command('app.retention_policy', 'UPDATE');
