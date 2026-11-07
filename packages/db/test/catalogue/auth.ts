// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the auth schema.

import type { SchemaCatalogue } from './index.ts';

export const auth: SchemaCatalogue = {
  executableBy: [
    // How the API learns about a session, without any grant in schema auth.
    ['auth.session_context(bytea)', ['app_api']],
    // A session's memberships, for switching tenant (ADR 0019).
    ['auth.session_memberships(bytea)', ['app_api']],
  ],
  definerFunctions: [
    [
      'auth.session_context(bytea)',
      {
        owner: 'owner_auth_session_context',
        rights: [
          'USAGE on schema auth',
          ...['id', 'status'].map((column) => `SELECT on column auth.user.${column}`),
          ...[
            'token_hash',
            'user_id',
            'active_tenant_id',
            'app',
            'mfa_state',
            'expires_at',
            'created_at',
            'last_seen_at',
            'reauthenticated_at',
            'revoked_at',
          ].map((column) => `SELECT on column auth.session.${column}`),
        ],
        policies: [
          'auth.session policy session_context_select',
          'auth.user policy session_context_select',
        ],
      },
    ],
    [
      'auth.session_memberships(bytea)',
      {
        owner: 'owner_auth_session_memberships',
        rights: [
          'USAGE on schema app',
          'USAGE on schema auth',
          ...['id', 'status'].map((column) => `SELECT on column auth.user.${column}`),
          ...[
            'token_hash',
            'user_id',
            'app',
            'mfa_state',
            'expires_at',
            'created_at',
            'last_seen_at',
            'revoked_at',
          ].map((column) => `SELECT on column auth.session.${column}`),
          ...['id', 'tenant_id', 'user_id', 'roles', 'status'].map(
            (column) => `SELECT on column app.membership.${column}`,
          ),
          ...['id', 'slug', 'name', 'status'].map(
            (column) => `SELECT on column app.tenant.${column}`,
          ),
        ],
        policies: [
          'app.membership policy session_memberships_select',
          'app.tenant policy session_memberships_select',
          'auth.session policy session_memberships_select',
          'auth.user policy session_memberships_select',
        ],
      },
    ],
  ],
  nonTenantTables: (
    [
      [
        'auth.user',
        'An account belongs to one person and may hold memberships in several tenants.',
      ],
      ['auth.session', 'A session belongs to an account; its active tenant grants nothing alone.'],
      ['auth.account', 'Credential accounts have no tenant; SSO identities add one later.'],
      ['auth.verification', 'Emailed links come before any tenant is known.'],
      ['auth.two_factor', 'MFA belongs to the account, whatever the tenant.'],
      ['auth.rate_limit', 'Sign-in limits count identifiers and addresses, not tenants.'],
      [
        'auth.device',
        'A device cookie belongs to an account, whatever the tenant, and grants no tenant.',
      ],
      ['auth.audit_event', 'Some auth events have no tenant, such as a failed sign-in.'],
      ['auth.audit_copy_pending', 'It holds only an auth event id and a time.'],
    ] as const
  ).map(
    ([table, reason]) =>
      [
        table,
        `${reason} On ADR 0003's allowlist: only app_auth and the function owners have grants.`,
      ] as const,
  ),
  auditTables: ['auth.audit_event'],
  ownSchema: {
    role: 'app_auth',
    outside: [
      'USAGE on schema app',
      'EXECUTE on function app.current_tenant_id()',
      'EXECUTE on function app.public_tenant(text)',
    ],
  },
};
