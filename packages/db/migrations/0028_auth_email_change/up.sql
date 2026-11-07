-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 0028, up: changing the sign-in email address (ADR 0010,
-- "Accounts, memberships and invitations"; S11-73).
--
-- app_auth may now update auth.user's email, which only the email change
-- route does, after the new address is proven; the unique index and the
-- column's check still hold. It may update no other column of the table
-- than before: email_verified and status stay out of its reach. The event check widens to email_changed,
-- keeping its name, so every existing row still passes. The list copies
-- authEventCodes in packages/domain/src/auth, and rights.test.ts reads it
-- back.

GRANT UPDATE (email) ON auth."user" TO app_auth;

ALTER TABLE auth.audit_event DROP CONSTRAINT audit_event_code_check;
ALTER TABLE auth.audit_event ADD CONSTRAINT audit_event_code_check CHECK (code IN (
  'account_created', 'sign_in_succeeded', 'sign_in_failed', 'rate_limit_reached',
  'mfa_enrolled', 'mfa_code_failed', 'pending_session_discarded', 'step_up_completed',
  'tenant_switched', 'signed_out', 'password_reset_requested', 'password_reset_completed',
  'sessions_revoked', 'invitation_accepted', 'mfa_removed', 'password_changed',
  'backup_code_used', 'backup_codes_regenerated', 'email_changed'));
