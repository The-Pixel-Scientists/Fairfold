-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0023, up: let auth.audit_event record an authenticator removed
-- and a password changed from a signed-in session (ADR 0010, "Audit";
-- S11-47).
--
-- The check keeps its name and only widens, so every existing row still
-- passes. No row is read, written or rewritten, and no grant, policy or
-- column changes. The list copies authEventCodes in
-- packages/domain/src/auth, and rights.test.ts reads it back.

ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed'));
