-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0025, down: restore the backup codes column and the auth event
-- codes of migration 0023.
--
-- Stored backup codes cannot be kept, since nothing before 0025 may hold
-- them, so this clears them; users make new ones after upgrading again.
-- Auth events are append-only (rule 4), so this never deletes or rewrites
-- one. The narrower check cannot hold an event recorded since 0025 with
-- either code it removes; the block below turns that violation into a clear
-- error, so the rollback then changes nothing. To roll back past such
-- events, restore the backup taken before the rollback (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0025 cannot be rolled back: auth events with backup_code_used or backup_codes_regenerated exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;

REVOKE UPDATE (backup_codes) ON auth.two_factor FROM app_auth;
ALTER TABLE auth.two_factor DROP CONSTRAINT two_factor_backup_codes_check;
UPDATE auth.two_factor SET backup_codes = NULL WHERE backup_codes IS NOT NULL;
ALTER TABLE auth.two_factor ADD CONSTRAINT two_factor_backup_codes_check CHECK (backup_codes IS NULL);
