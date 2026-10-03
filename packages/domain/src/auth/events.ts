// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The codes `auth.audit_event` accepts (ADR 0010), for the first release's
// auth: email-first sign-up, password sign-in and reset, TOTP for staff,
// step-up, switching tenant and invitations. The others in ADR 0010's list
// join with their features.

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
] as const;

export type AuthEventCode = (typeof authEventCodes)[number];
