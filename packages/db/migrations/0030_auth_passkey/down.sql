-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0030, down: drop passkeys, and restore the auth event codes of
-- migration 0028.
--
-- Auth events are append-only (rule 4), so this never deletes or rewrites
-- one. The narrower check cannot hold a passkey_added or passkey_removed
-- event; the block below turns that violation into a clear error, so the
-- rollback then changes nothing. Otherwise every passkey goes with the
-- table: their users sign in with a password and their other factors, or
-- not at all if a passkey was their only credential. To keep them, restore
-- the backup taken before the rollback (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
    'backup_code_used', 'backup_codes_regenerated', 'email_changed'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0030 cannot be rolled back: auth events with passkey_added or passkey_removed exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

REVOKE ALL ON auth.passkey FROM app_auth;
DROP TABLE auth.passkey;
