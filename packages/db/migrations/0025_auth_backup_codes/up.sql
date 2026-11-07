-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0025, up: backup codes (ADR 0010, "Secrets at rest"; S11-49).
--
-- auth.two_factor.backup_codes holds a set of codes as HMACs: the purpose
-- key's version, a colon, then 1 to 10 HMAC-SHA-256 values in lower-case
-- hex, separated by commas. The check refuses anything else, so no code can
-- be stored in clear, and keeps codes only beside a confirmed factor.
-- app_auth may now update the column; it still may not insert it, and no
-- other role gains a right. The event check widens to the two backup code
-- events, keeping its name, so every existing row still passes. The list
-- copies authEventCodes in packages/domain/src/auth, and rights.test.ts
-- reads it back.

ALTER TABLE auth.two_factor DROP CONSTRAINT two_factor_backup_codes_check;
ALTER TABLE auth.two_factor ADD CONSTRAINT two_factor_backup_codes_check CHECK (
  backup_codes IS NULL
  OR (verified AND backup_codes ~ '^[1-9][0-9]{0,8}:[0-9a-f]{64}(,[0-9a-f]{64}){0,9}$'));
GRANT UPDATE (backup_codes) ON auth.two_factor TO app_auth;

ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
  'backup_code_used', 'backup_codes_regenerated'));
