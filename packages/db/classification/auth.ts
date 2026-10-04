// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the auth schema (ADR 0010). Accounts span
// tenants, so their rows last as long as the account. A session's IP address
// and user agent go with its row, at most 90 days after it was last used,
// which is no later than 90 days after it ended. Auth events are kept 12
// months; their typed identifiers and IP addresses are personal. Ids are
// internal, as in every schema, while a user_id that links a row to a person
// is personal. Hashes, encrypted secrets and counters are internal.

import type {
  ClassificationRegistry,
  FieldClassification,
  Sensitivity,
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
    count: counter,
    window_started_at: counter,
    blocked_until: counter,
    created_at: counter,
    updated_at: counter,
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
  },
  'auth.audit_copy_pending': {
    auth_event_id: pending,
    created_at: pending,
  },
};
