// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The codes `auth.audit_event` accepts (ADR 0010), for the first release's
// auth: email-first sign-up, password sign-in and reset, TOTP for staff,
// step-up, switching tenant and invitations; then changing or removing an
// authenticator and the password when signed in; then backup codes; then
// changing the email address; then passkeys; then the audit retention
// purge's count of what it deleted; then the operator's breached-password
// check setting, recorded at start-up when it changes. The others in ADR 0010's list join with
// the feature that first writes them, whose migration widens the table's
// check in the same change: the list and the check stay equal.

export const authEventCodes = [
  'account_created',
  'sign_in_succeeded',
  'sign_in_failed',
  'rate_limit_reached',
  'mfa_enrolled',
  'mfa_code_failed',
  'pending_session_discarded',
  'step_up_completed',
  'tenant_switched',
  'signed_out',
  'password_reset_requested',
  'password_reset_completed',
  'sessions_revoked',
  'invitation_accepted',
  'mfa_removed',
  'password_changed',
  'backup_code_used',
  'backup_codes_regenerated',
  'email_changed',
  'passkey_added',
  'passkey_removed',
  'audit_purged',
  'password_check_setting_changed',
] as const;

export type AuthEventCode = (typeof authEventCodes)[number];
