// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The codes of `auth.audit_event` (ADR 0010): first the first release's
// auth, then the deferred features (account changes, backup codes, passkeys,
// SSO and the operator's commands), whose handlers write them, and the purge
// of `auth.audit_event` itself (S11-97). Each needs the table's check to
// allow it before a handler writes it.

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
  'password_changed',
  'email_changed',
  'mfa_removed',
  'backup_code_used',
  'backup_codes_regenerated',
  'passkey_added',
  'passkey_removed',
  'sso_session_created',
  'sso_response_rejected',
  'sso_provider_changed',
  'sso_domain_changed',
  'sso_domain_conflict',
  'account_deactivated',
  'secrets_reencrypted',
  'audit_copy_replayed',
  'audit_purged',
] as const;

export type AuthEventCode = (typeof authEventCodes)[number];
