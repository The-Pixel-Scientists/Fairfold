-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0035, up: the secret re-encryption command's event (ADR 0010,
-- "Secrets at rest" and "Audit"; S11-105).
--
-- auth.audit_event takes secrets_re_encrypted, one per run, with the key
-- version it re-encrypted to and its counts: TOTP secrets, SSO providers,
-- and users asked to generate new backup codes. Its reason is empty, or
-- incomplete for a run that stopped part-way. It has no user, tenant,
-- identifier or address, and no other event has a version or count.

ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
  'backup_code_used', 'backup_codes_regenerated', 'email_changed', 'passkey_added',
  'passkey_removed', 'audit_purged', 'password_check_setting_changed',
  'secrets_re_encrypted'));

ALTER TABLE auth.audit_event
  ADD COLUMN key_version smallint CHECK (key_version >= 1),
  ADD COLUMN totp_count integer CHECK (totp_count >= 0),
  ADD COLUMN sso_count integer CHECK (sso_count >= 0),
  ADD COLUMN backup_notice_count integer CHECK (backup_notice_count >= 0),
  ADD CONSTRAINT audit_event_secrets_re_encrypted CHECK (CASE
    WHEN code = 'secrets_re_encrypted' THEN
      num_nulls(key_version, totp_count, sso_count, backup_notice_count) = 0
      AND num_nonnulls(user_id, tenant_id, identifier, ip_address) = 0
      AND (reason IS NULL OR reason = 'incomplete')
    ELSE num_nonnulls(key_version, totp_count, sso_count, backup_notice_count) = 0
  END);

GRANT INSERT (key_version, totp_count, sso_count, backup_notice_count)
   ON auth.audit_event TO app_auth;
