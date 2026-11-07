-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0038, down: drop the audit_copy_replayed event code, its column
-- and the pending copies' time index.
--
-- Auth events are append-only (rule 4), so this never deletes or rewrites
-- one. The narrower check cannot hold an audit_copy_replayed event; the
-- block below turns that violation into a clear error, so the rollback then
-- changes nothing. To roll back past a replay, restore the backup taken
-- before the rollback (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
    'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
    'passkey_removed', 'audit_purged', 'password_check_setting_changed',
    'secrets_re_encrypted'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0038 cannot be rolled back: auth events with audit_copy_replayed exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

DROP INDEX auth.audit_copy_pending_created_at;
REVOKE INSERT (replayed_event_id) ON auth.audit_event FROM app_auth;
ALTER TABLE auth.audit_event
  DROP CONSTRAINT audit_event_audit_copy_replayed,
  DROP COLUMN replayed_event_id;
