-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0023, down: restore the auth event codes of migration 0004.
--
-- Auth events are append-only (rule 4), so this never deletes or rewrites
-- one. The narrower check cannot hold an event recorded since 0023 with
-- either code it removes; adding it reads every row whatever the policies,
-- and the block below turns its violation into a clear error, so the
-- rollback then changes nothing. To roll back past such events, restore the
-- backup taken before the rollback (ADR 0003).

DO $restore$
BEGIN
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0023 cannot be rolled back: auth events with mfa_removed or password_changed exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;
