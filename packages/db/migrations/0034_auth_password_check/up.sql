-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0034, up: the breached-password check's state (ADR 0010,
-- "Sign-in limits and passwords"; S11-77).
--
-- - auth.account gains breach_check_pending_since, set when the service did
--   not answer as the password was stored, and password_breached_at, set
--   when the next sign-in found the password in a breach. Never both, and
--   only on credential accounts. app_auth writes them; nothing derived from
--   the password is kept.
-- - auth.session_context() answers password_change_required, in place of
--   complete, for a session whose account holds a breached password, and
--   no row for one that has not proven a factor (enrol or not_required):
--   such a session holds only the breached password. The function is
--   replaced as its owner (ADR 0023), so its owner and EXECUTE grants stay
--   as they are; the owner gets SELECT on the two account columns it reads.
-- - auth.audit_event takes password_check_setting_changed, the operator's
--   setting at start-up as its reason, on or off, with no user, tenant,
--   identifier or address.

ALTER TABLE auth.account
  ADD COLUMN breach_check_pending_since timestamptz,
  ADD COLUMN password_breached_at timestamptz,
  ADD CONSTRAINT account_breach_state_one
    CHECK (breach_check_pending_since IS NULL OR password_breached_at IS NULL),
  ADD CONSTRAINT account_breach_state_credential
    CHECK (provider_id = 'credential'
           OR (breach_check_pending_since IS NULL AND password_breached_at IS NULL));
GRANT INSERT (breach_check_pending_since),
      UPDATE (breach_check_pending_since, password_breached_at)
   ON auth.account TO app_auth;

ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
  'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
  'passkey_removed', 'audit_purged', 'password_check_setting_changed'));
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_password_check_setting
  CHECK (code <> 'password_check_setting_changed'
         OR (reason IN ('on', 'off') AND user_id IS NULL AND tenant_id IS NULL
             AND identifier IS NULL AND ip_address IS NULL));
-- The API reads the last setting at start-up without scanning the year's events.
CREATE INDEX audit_event_password_check_setting ON auth.audit_event (occurred_at)
  WHERE code = 'password_check_setting_changed';

-- The owner's rights come first: the body below is parsed as it is created.
GRANT SELECT (user_id, password_breached_at) ON auth.account TO owner_auth_session_context;
CREATE POLICY session_context_select ON auth.account FOR SELECT
  TO owner_auth_session_context USING (true);

GRANT CREATE ON SCHEMA auth TO owner_auth_session_context;
SET LOCAL ROLE owner_auth_session_context;

-- The live session whose token hashes to token_hash: not revoked, its user
-- active, inside its app's idle and absolute timeouts and Better Auth's
-- expiry, and, while waiting for MFA, at most 10 minutes old (ADR 0010).
-- expires_at is when it ends unless used. A session whose account holds a
-- breached password is password_change_required once MFA is complete, and
-- not live at all without a proven factor. No row for any other hash.
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
  SELECT s.user_id, s.active_tenant_id, s.app,
         CASE WHEN b.breached AND s.mfa_state = 'complete' THEN 'password_change_required'
              ELSE s.mfa_state END,
         e.ends_at, s.reauthenticated_at
    FROM auth.session AS s
    JOIN auth."user" AS u ON u.id = s.user_id
    JOIN (VALUES ('console', interval '30 minutes', interval '12 hours'),
                 ('portal', interval '60 minutes', interval '24 hours'))
      AS t (app, idle, absolute) ON t.app = s.app
   CROSS JOIN LATERAL (SELECT EXISTS (
       SELECT 1 FROM auth.account AS a
        WHERE a.user_id = s.user_id AND a.password_breached_at IS NOT NULL) AS breached) AS b
   CROSS JOIN LATERAL (SELECT LEAST(
       s.expires_at, s.created_at + t.absolute, s.last_seen_at + t.idle,
       CASE WHEN s.mfa_state IN ('enrol', 'verify') THEN s.created_at + interval '10 minutes' END)
     AS ends_at) AS e
   WHERE s.token_hash = session_context.token_hash
     AND s.revoked_at IS NULL
     AND u.status = 'active'
     AND e.ends_at > pg_catalog.now()
     AND NOT (b.breached AND s.mfa_state IN ('enrol', 'not_required'));
END;

RESET ROLE;
REVOKE CREATE ON SCHEMA auth FROM owner_auth_session_context;
