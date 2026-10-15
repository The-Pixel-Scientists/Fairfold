// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Better Auth, configured to ADR 0010's rules. Its HTTP handler is never
// mounted: our routes (S02-01's contracts) call its server API, as
// `auth.api.<endpoint>({ body, headers })`. Core and the two-factor plugin
// only, on the auth schema through our adapter, with the tables' snake-case
// columns (migration 0004).

import type { Kysely } from '@pixel-scientists/db';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins/two-factor';

import { ConfigError } from '../config.ts';
import { authAdapter } from './adapter.ts';
import type { AuthSettings } from './settings.ts';

/**
 * The only header Better Auth reads a client address from. Our routes set it
 * to the address Fastify derives through the trusted proxy list, so a
 * spoofed X-Forwarded-For counts for nothing.
 */
export const CLIENT_IP_HEADER = 'x-tps-client-ip';

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

/**
 * Variables Better Auth reads from process.env over the checked settings:
 * secrets, a base URL (which it trusts as an origin), more trusted origins,
 * and telemetry, which they turn back on. Every name containing BETTER_AUTH_
 * is refused, so a later release's new variable cannot slip in either.
 * Compared in upper case, as Windows reads them. Better Auth ignores
 * BASE_URL=/, which Vite and Vitest set.
 */
const OVERRIDES = new Set(['AUTH_SECRET', 'AUTH_URL', 'BASE_URL', 'NUXT_PUBLIC_AUTH_URL']);

/** Throw a ConfigError naming each such variable that is set. */
function refuseOverrides(): void {
  const set = Object.entries(process.env)
    .filter(([name, value]) => {
      const upper = name.toUpperCase();
      if (upper === 'BASE_URL' && value === '/') return false;
      return OVERRIDES.has(upper) || upper.includes('BETTER_AUTH_');
    })
    .map(([name]) => name);
  if (set.length > 0) {
    throw new ConfigError(
      set.sort().map((name) => `Unset ${name}: the API configures Better Auth itself.`),
    );
  }
}

export function createBetterAuth(settings: AuthSettings, db: Kysely<unknown>) {
  refuseOverrides();
  return betterAuth({
    secret: settings.secret.reveal(),
    basePath: '/api/auth',
    trustedOrigins: [...new Set([settings.origins.console, settings.origins.portal])],
    database: authAdapter(db),
    telemetry: { enabled: false },
    // Its messages can carry values from requests; our routes log instead.
    logger: { disabled: true },
    // Our own limits apply (ADR 0010, S02-08).
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      autoSignIn: false,
    },
    emailVerification: { autoSignInAfterVerification: false },
    user: { fields: { emailVerified: 'email_verified', ...timestamps } },
    session: {
      cookieCache: { enabled: false },
      fields: {
        token: 'token_hash',
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        ...timestamps,
      },
      additionalFields: {
        app: { type: 'string', required: true, input: false },
        activeTenantId: {
          type: 'string',
          required: false,
          input: false,
          fieldName: 'active_tenant_id',
        },
        mfaState: { type: 'string', required: true, input: false, fieldName: 'mfa_state' },
      },
    },
    account: {
      accountLinking: { enabled: false },
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        ...timestamps,
      },
    },
    verification: {
      storeIdentifier: 'hashed',
      fields: { expiresAt: 'expires_at', ...timestamps },
    },
    advanced: {
      useSecureCookies: true,
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    plugins: [
      twoFactor({
        schema: {
          user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
          twoFactor: {
            modelName: 'two_factor',
            fields: {
              userId: 'user_id',
              backupCodes: 'backup_codes',
              failedVerificationCount: 'failed_verification_count',
              lockedUntil: 'locked_until',
            },
          },
        },
      }),
    ],
  });
}

export type BetterAuth = ReturnType<typeof createBetterAuth>;
