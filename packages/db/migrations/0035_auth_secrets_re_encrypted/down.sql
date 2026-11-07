-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0035, down: drop the secrets_re_encrypted event code and its
-- columns.
--
-- Auth events are append-only (rule 4), so this never deletes or rewrites
-- one. The narrower check cannot hold a secrets_re_encrypted event; the
-- block below turns that violation into a clear error, so the rollback then
-- changes nothing. To roll back past a run, restore the backup taken before
-- the rollback (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
    'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
    'passkey_removed', 'audit_purged', 'password_check_setting_changed'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0035 cannot be rolled back: auth events with secrets_re_encrypted exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

ALTER TABLE auth.audit_event
  DROP CONSTRAINT audit_event_secrets_re_encrypted,
  DROP COLUMN key_version,
  DROP COLUMN totp_count,
  DROP COLUMN sso_count,
  DROP COLUMN backup_notice_count;
