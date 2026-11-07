-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0028, down: take back app_auth's update of auth.user's email,
-- and restore the auth event codes of migration 0025.
--
-- Auth events are append-only (rule 4), so this never deletes or rewrites
-- one. The narrower check cannot hold an email_changed event; the block
-- below turns its violation into a clear error, so the rollback then changes
-- nothing. To roll back past such events, restore the backup taken before
-- the rollback (ADR 0003).

DO $restore$
BEGIN
  REVOKE UPDATE (email) ON auth."user" FROM app_auth;
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
    'backup_code_used', 'backup_codes_regenerated'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0028 cannot be rolled back: auth events with email_changed exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;
