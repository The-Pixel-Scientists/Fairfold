-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0034, down: restore migration 0004's auth.session_context(),
-- drop the breached-password state and the setting event code.
--
-- Auth events are append-only (rule 4), so this never deletes or rewrites
-- one. The narrower check cannot hold a password_check_setting_changed
-- event; the block below turns that violation into a clear error, so the
-- rollback then changes nothing. Otherwise the account flags go with their
-- columns: a pending check is not run again, and a breached password signs
-- in as before. To keep them, restore the backup taken before the rollback
-- (ADR 0003).

GRANT CREATE ON SCHEMA auth TO owner_auth_session_context;
SET LOCAL ROLE owner_auth_session_context;

-- The live session whose token hashes to token_hash: not revoked, its user
-- active, inside its app's idle and absolute timeouts and Better Auth's
-- expiry, and, while waiting for MFA, at most 10 minutes old (ADR 0010).
-- expires_at is when it ends unless used. No row for any other hash. The
-- body is parsed here, so every name is fixed now, and the timeouts join by
-- app, so an unknown app matches nothing.
CREATE OR REPLACE FUNCTION auth.session_context(token_hash bytea)
  RETURNS TABLE (
    user_id uuid,
    active_tenant_id uuid,
    app text,
    mfa_state text,
    expires_at timestamptz,
    reauthenticated_at timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT s.user_id, s.active_tenant_id, s.app, s.mfa_state, e.ends_at, s.reauthenticated_at
    FROM auth.session AS s
    JOIN auth."user" AS u ON u.id = s.user_id
    JOIN (VALUES ('console', interval '30 minutes', interval '12 hours'),
                 ('portal', interval '60 minutes', interval '24 hours'))
      AS t (app, idle, absolute) ON t.app = s.app
   CROSS JOIN LATERAL (SELECT LEAST(
       s.expires_at, s.created_at + t.absolute, s.last_seen_at + t.idle,
       CASE WHEN s.mfa_state IN ('enrol', 'verify') THEN s.created_at + interval '10 minutes' END)
     AS ends_at) AS e
   WHERE s.token_hash = session_context.token_hash
     AND s.revoked_at IS NULL
     AND u.status = 'active'
     AND e.ends_at > pg_catalog.now();
END;

RESET ROLE;
REVOKE CREATE ON SCHEMA auth FROM owner_auth_session_context;

DROP POLICY session_context_select ON auth.account;
REVOKE SELECT (user_id, password_breached_at) ON auth.account FROM owner_auth_session_context;

DO $restore$
BEGIN
  ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
  ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
    'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
    'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
    'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
    'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
    'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
    'passkey_removed', 'audit_purged'));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Migration 0034 cannot be rolled back: auth events with password_check_setting_changed exist.'
    USING HINT = 'Restore the database backup taken before the rollback, as ADR 0003 sets out.';
END
$restore$;
DROP INDEX auth.audit_event_password_check_setting;
ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_password_check_setting;

REVOKE INSERT (breach_check_pending_since),
       UPDATE (breach_check_pending_since, password_breached_at)
    ON auth.account FROM app_auth;
ALTER TABLE auth.account
  DROP CONSTRAINT account_breach_state_credential,
  DROP CONSTRAINT account_breach_state_one,
  DROP COLUMN password_breached_at,
  DROP COLUMN breach_check_pending_since;
