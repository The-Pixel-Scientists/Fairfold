// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The columns the auth module reads and writes (migrations 0002 to 0004).
// The auth tables are reached as app_auth; the app tables as app_api,
// inside withTenant().

import type { Generated } from '@pixel-scientists/db';
import type { AuthEventCode } from '@pixel-scientists/domain/auth';

export type AuthTables = {
  'auth.user': { id: string; email: string };
  'auth.session': {
    user_id: string;
    token_hash: Buffer;
    active_tenant_id: string | null;
    revoked_at: Date | null;
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
};

export type TenantTables = {
  'app.membership': {
    id: string;
    tenant_id: string;
    user_id: string;
    roles: string[];
    status: string;
  };
  'app.tenant': { id: string; slug: string; name: string; status: string };
  'app.tenant_module': { module: string; enabled: boolean };
};
