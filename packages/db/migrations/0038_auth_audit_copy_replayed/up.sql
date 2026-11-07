-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0038, up: the audit-copy replay command's event (ADR 0010,
-- "Audit"; S11-68).
--
-- auth.audit_event takes audit_copy_replayed, one for each auth event the
-- command copied to its tenant's audit log: the replayed event's id and
-- tenant, and no user, identifier, address or reason. No other event has a
-- replayed event id. The id has no foreign key, as app.audit_event's
-- entity_id has none: the retention purge removes the replayed event first,
-- and a key would block it.
--
-- The pending copies get an index on their time, so the oldest-copy metric
-- and the replay read them in order without scanning the table.

ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
  'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
  'passkey_removed', 'audit_purged', 'password_check_setting_changed',
  'secrets_re_encrypted', 'audit_copy_replayed'));

ALTER TABLE auth.audit_event
  ADD COLUMN replayed_event_id uuid,
  ADD CONSTRAINT audit_event_audit_copy_replayed CHECK (CASE
    WHEN code = 'audit_copy_replayed' THEN
      replayed_event_id IS NOT NULL AND tenant_id IS NOT NULL
      AND num_nonnulls(user_id, identifier, ip_address, reason) = 0
    ELSE replayed_event_id IS NULL
  END);

GRANT INSERT (replayed_event_id) ON auth.audit_event TO app_auth;

CREATE INDEX audit_copy_pending_created_at ON auth.audit_copy_pending (created_at);
