// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the auth schema (ADR 0010). Accounts span
// tenants, so their rows last as long as the account. A session's IP address
// and user agent go with its row, at most 90 days after it was last used,
// which is no later than 90 days after it ended. Auth events are kept 12
// months; their typed identifiers and IP addresses are personal, and the
// retention purge's count of the events it deleted is internal. Ids are
// internal, as in every schema, while a user_id that links a row to a person
// is personal. Hashes, encrypted secrets and counters are internal, except a
// device's hash and the counter keyed by it, which are online identifiers. A
// device goes 12 months after issue, or 30 days after revocation if that is
// sooner (limits/devices.ts in apps/api/src/auth deletes it).
//
// A tenant's SSO set-up is kept while the tenant is a customer, and each
// row goes when its provider is removed: a domain and a used assertion id
// with their provider, and an SSO identity with its provider or account.
// The sealed client secret and signing key, and the DNS token, are
// internal. An SSO identity's subject is its account_id, personal like a
// credential account's; its tenant, provider and issuer are internal. A
// used assertion id goes a day after it expires.
//
// A passkey is kept with its account until the user removes it or the
// account goes. Its credential id, public key and AAGUID are personal
// account security data, and so is its name, which the user types.

import type {
  ClassificationRegistry,
  FieldClassification,
  Sensitivity,
  SubjectPathRegistry,
} from '../classification.ts';

const account = (sensitivity: Sensitivity): FieldClassification => ({
  sensitivity,
  retention: { kind: 'account_lifetime' },
});
const fixed = (sensitivity: Sensitivity, days: number, from: string): FieldClassification => ({
  sensitivity,
  retention: { kind: 'fixed', days, from },
});

const accountInternal = account('internal');
const accountPersonal = account('personal');
const session = fixed('internal', 90, 'last_seen_at');
const sessionPersonal = fixed('personal', 90, 'last_seen_at');
const verification = fixed('internal', 1, 'expires_at');
const counter = fixed('internal', 2, 'updated_at');
const counterPersonal = fixed('personal', 2, 'updated_at');
// 366 days, so no event goes before its 12 months are up.
const audit = fixed('internal', 366, 'occurred_at');
const auditPersonal = fixed('personal', 366, 'occurred_at');
const pending = fixed('internal', 366, 'created_at');
const device = fixed('internal', 366, 'issued_at');
const sso: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};
const replay = fixed('internal', 1, 'expires_at');
const devicePersonal = fixed('personal', 366, 'issued_at');

export const auth: ClassificationRegistry = {
  'auth.user': {
    id: accountInternal,
    name: accountPersonal,
    email: accountPersonal,
    email_verified: accountInternal,
    two_factor_enabled: accountInternal,
    status: accountInternal,
    created_at: accountInternal,
    updated_at: accountInternal,
  },
  'auth.session': {
    id: session,
    user_id: sessionPersonal,
    token_hash: session,
    app: session,
    active_tenant_id: session,
    mfa_state: session,
    mfa_failures: session,
    expires_at: session,
    last_seen_at: session,
    reauthenticated_at: session,
    revoked_at: session,
    ip_address: sessionPersonal,
    user_agent: sessionPersonal,
    created_at: session,
    updated_at: session,
  },
  'auth.account': {
    id: accountInternal,
    user_id: accountPersonal,
    account_id: accountPersonal,
    provider_id: accountInternal,
    password: accountInternal,
    created_at: accountInternal,
    updated_at: accountInternal,
    tenant_id: accountInternal,
    sso_provider_id: accountInternal,
    sso_issuer: accountInternal,
    // Account security state: kept with the account, and cleared when a
    // password passes the breach check or is changed (migration 0034).
    breach_check_pending_since: accountPersonal,
    password_breached_at: accountPersonal,
  },
  'auth.verification': {
    id: verification,
    identifier: verification,
    // It may name the account or address a link is for.
    value: fixed('personal', 1, 'expires_at'),
    expires_at: verification,
    created_at: verification,
    updated_at: verification,
  },
  'auth.two_factor': {
    id: accountInternal,
    user_id: accountPersonal,
    secret: accountInternal,
    verified: accountInternal,
    backup_codes: accountInternal,
    failed_verification_count: accountInternal,
    locked_until: accountInternal,
    last_used_step: accountInternal,
    created_at: accountInternal,
    updated_at: accountInternal,
  },
  'auth.rate_limit': {
    id: counter,
    scope: counter,
    identifier: counterPersonal,
    client_ip: counterPersonal,
    device_id: counterPersonal,
    count: counter,
    window_started_at: counter,
    blocked_until: counter,
    created_at: counter,
    updated_at: counter,
  },
  'auth.device': {
    id: device,
    user_id: devicePersonal,
    device_hash: devicePersonal,
    key_version: device,
    issued_at: device,
    last_used_at: device,
    revoked_at: device,
    created_at: device,
    updated_at: device,
  },
  'auth.passkey': {
    id: accountInternal,
    user_id: accountPersonal,
    credential_id: accountPersonal,
    public_key: accountPersonal,
    counter: accountInternal,
    name: accountPersonal,
    device_type: accountInternal,
    backed_up: accountInternal,
    transports: accountInternal,
    aaguid: accountPersonal,
    last_used_at: accountInternal,
    created_at: accountInternal,
    updated_at: accountInternal,
  },
  'auth.audit_event': {
    id: audit,
    occurred_at: audit,
    retain_until: audit,
    request_id: audit,
    code: audit,
    reason: audit,
    user_id: auditPersonal,
    tenant_id: audit,
    identifier: auditPersonal,
    ip_address: auditPersonal,
    purged_count: audit,
  },
  'auth.audit_copy_pending': {
    auth_event_id: pending,
    created_at: pending,
  },
  'auth.sso_provider': Object.fromEntries(
    [
      'tenant_id',
      'id',
      'kind',
      'name',
      'issuer',
      'client_id',
      'client_secret',
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'userinfo_endpoint',
      'mfa_amr',
      'mfa_acr',
      'entity_id',
      'sso_url',
      'certificates',
      'sp_certificate',
      'sp_private_key',
      'mfa_contexts',
      'key_version',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
    ].map((column) => [column, sso]),
  ),
  'auth.sso_domain': Object.fromEntries(
    [
      'tenant_id',
      'id',
      'provider_id',
      'domain',
      'dns_token',
      'state',
      'verified_at',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
    ].map((column) => [column, sso]),
  ),
  'auth.saml_replay': {
    tenant_id: replay,
    id: replay,
    provider_id: replay,
    assertion_id: replay,
    expires_at: replay,
    created_at: replay,
    updated_at: replay,
  },
};

/**
 * Each table's path to the person its rows are about (ADR 0027): the account,
 * which reaches a person in a tenant through party.person.user_id. An auth
 * event for an unknown identifier has none.
 */
export const authSubjects: SubjectPathRegistry = {
  'auth.user': { kind: 'account', column: 'id' },
  'auth.session': { kind: 'account', column: 'user_id' },
  'auth.account': { kind: 'account', column: 'user_id' },
  'auth.verification': {
    kind: 'unlinked',
    reason: 'An emailed link comes before any account is known, and goes a day after it expires.',
  },
  'auth.two_factor': { kind: 'account', column: 'user_id' },
  'auth.rate_limit': {
    kind: 'unlinked',
    reason: 'Sign-in limits count typed identifiers and addresses, not accounts.',
  },
  'auth.device': { kind: 'account', column: 'user_id' },
  'auth.passkey': { kind: 'account', column: 'user_id' },
  'auth.audit_event': { kind: 'account', column: 'user_id' },
};
