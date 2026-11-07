-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0031, down: remove app.purge_expired_audit(), its owner's
-- policies and rights, the purge indexes, the purge count and the
-- audit_purged code.
--
-- Events the purge deleted cannot come back. Auth events are append-only
-- (rule 4), so this never deletes the purge's own events either: the
-- narrower check cannot hold an audit_purged event, and the block below
-- turns that violation into a clear error, so the rollback then changes
-- nothing. To roll back past a purge, restore the backup taken before the
-- rollback (ADR 0003). The function goes first; migrator owns the schema,
-- so it may drop it (ADR 0023).

DROP FUNCTION app.purge_expired_audit();

DROP POLICY purge_expired_audit_select ON app.audit_event;
DROP POLICY purge_expired_audit_delete ON app.audit_event;
DROP POLICY purge_expired_audit_insert ON app.audit_event;
DROP POLICY purge_expired_audit_select ON auth.audit_event;
DROP POLICY purge_expired_audit_delete ON auth.audit_event;
DROP POLICY purge_expired_audit_insert ON auth.audit_event;

REVOKE SELECT (id, retain_until), DELETE, INSERT (request_id, code, purged_count)
    ON auth.audit_event FROM owner_app_purge_expired_audit;
REVOKE SELECT (id, tenant_id, retain_until), DELETE,
       INSERT (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
    ON app.audit_event FROM owner_app_purge_expired_audit;
REVOKE SELECT (tenant_id, policy, days) ON app.retention_policy FROM owner_app_purge_expired_audit;
REVOKE EXECUTE ON FUNCTION app.current_tenant_id() FROM owner_app_purge_expired_audit;
REVOKE USAGE ON SCHEMA app, auth FROM owner_app_purge_expired_audit;

DROP INDEX auth.audit_event_retain_until;
DROP INDEX app.audit_event_retain_until;

DO $restore$
BEGIN
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
    'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
    'passkey_removed'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0031 cannot be rolled back: auth events with audit_purged exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

ALTER TABLE auth.audit_event DROP COLUMN purged_count;
