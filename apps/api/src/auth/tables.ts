// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The columns the auth module reads and writes (migrations 0002 to 0004,
// and 0015). The auth tables are reached as app_auth; the app tables as
// app_api, inside withTenant().

import type { Generated } from '@pixel-scientists/db';
import type { AuthEventCode } from '@pixel-scientists/domain/auth';
import type { App } from '@pixel-scientists/domain/platform';

import type { MfaState } from '../context.ts';

export type AuthTables = {
  'auth.user': {
    id: Generated<string>;
    email: string;
    email_verified: boolean;
    status: Generated<string>;
    two_factor_enabled: Generated<boolean>;
  };
  'auth.account': { user_id: string; account_id: string; provider_id: string; password: string };
  'auth.verification': { identifier: string; value: string; expires_at: Date };
  'auth.two_factor': {
    user_id: string;
    secret: string;
    verified: boolean;
    /** A bigint: written as a number, read as text. */
    last_used_step: string | number | null;
  };
  'auth.session': {
    user_id: string;
    token_hash: Buffer;
    app: App;
    active_tenant_id: string | null;
    mfa_state: MfaState;
    mfa_failures: Generated<number>;
    expires_at: Date;
    reauthenticated_at: Date | null;
    revoked_at: Date | null;
    ip_address: string;
    user_agent: string | null;
  };
  'auth.audit_event': {
    id: Generated<string>;
    request_id: string;
    code: AuthEventCode;
    reason: string | null;
    user_id: string | null;
    tenant_id: string | null;
    identifier: string | null;
    ip_address: string | null;
  };
  'auth.audit_copy_pending': { auth_event_id: string };
  'auth.rate_limit': { scope: string; identifier: string | null };
};

export type TenantTables = {
  'app.membership': {
    id: Generated<string>;
    tenant_id: string;
    user_id: string;
    roles: string[];
    status: Generated<string>;
    created_by: string | null;
    updated_by: string | null;
  };
  'app.invitation': {
    tenant_id: string;
    id: string;
    email: string;
    roles: string[];
    token_hash: Buffer;
    expires_at: Generated<Date>;
    status: Generated<'pending' | 'accepted' | 'revoked'>;
    accepted_membership_id: string | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'app.tenant': { id: string; slug: string; name: string; status: string };
  'app.tenant_module': { module: string; enabled: boolean };
};
