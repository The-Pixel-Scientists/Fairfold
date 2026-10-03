// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the auth routes accept and answer (ADR 0010): addresses, passwords,
// emailed tokens, TOTP codes and the session the apps see.

import { z } from 'zod';

import { idSchema } from '../id.ts';
import { permissions, type App, type Permission } from '../platform/access.ts';
import { messages } from '../platform/messages.ts';
import { roles, type Role } from '../platform/roles.ts';

/**
 * Trimmed and lower-cased before it is checked, so one address is always one
 * account. The format mark tells the OpenAPI document and the URL rule that
 * this is an email address.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: messages.email }).max(254, { error: messages.emailTooLong }))
  .meta({ format: 'email' });

/** Length only; the server also refuses common passwords (ADR 0010). */
export const passwordSchema = z
  .string()
  .min(12, { error: messages.passwordTooShort })
  .max(256, { error: messages.passwordTooLong });

/** The single-use token from an emailed link. */
export const tokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,128}$/, { error: messages.linkNotValid });

/** A password being checked, not set: no rules beyond a length bound. */
export const currentPasswordSchema = z
  .string()
  .min(1, { error: messages.enterPassword })
  .max(256, { error: messages.passwordTooLong });

export const totpCodeSchema = z.string().regex(/^[0-9]{6}$/, { error: messages.totpCode });

/**
 * Where a session stands on MFA: enrolment or a code still to come (the
 * session reaches only the MFA routes until then), done (the console), or
 * not needed (the portal, whose applicants have no MFA in MVP1).
 */
export const mfaStates = ['enrol', 'verify', 'complete', 'not_required'] as const;

function permissionsIn(app: App) {
  const ids = (Object.keys(permissions) as Permission[]).filter(
    (id) => permissions[id].app === app,
  );
  return z.array(z.enum(ids as [Permission, ...Permission[]]));
}

function membershipIn(app: App) {
  const ids = (Object.keys(roles) as Role[]).filter((id) => roles[id].app === app);
  return z.object({
    id: idSchema,
    tenant: z.object({ slug: z.string(), name: z.string() }),
    roles: z.array(z.enum(ids as [Role, ...Role[]])),
  });
}

const base = {
  user: z.object({ id: idSchema, email: z.string() }),
  /** When the session ends unless used, for the warning before the idle timeout. */
  expiresAt: z.iso.datetime(),
};

/**
 * Signed in to one app with MFA settled. Permissions come from the active
 * membership, so a session without one has none, and every role and
 * permission belongs to the session's app.
 */
function signedIn<A extends App, M extends 'complete' | 'not_required'>(app: A, mfa: M) {
  const membership = membershipIn(app);
  const session = {
    ...base,
    app: z.literal(app),
    mfa: z.literal(mfa),
    /** Until when the last re-authentication counts as recent (step-up). */
    recentAuthUntil: z.iso.datetime().nullable(),
    /** The memberships this app can switch to. */
    memberships: z.array(membership),
  };
  return [
    z.object({ ...session, activeMembership: membership, permissions: permissionsIn(app) }),
    z.object({ ...session, activeMembership: z.null(), permissions: z.tuple([]) }),
  ] as const;
}

/** A session waiting for MFA, which only staff have in MVP1, holds nothing in any tenant. */
export const sessionSchema = z.union([
  z.object({
    ...base,
    app: z.literal('console'),
    mfa: z.enum(['enrol', 'verify']),
    recentAuthUntil: z.null(),
    activeMembership: z.null(),
    memberships: z.tuple([]),
    permissions: z.tuple([]),
  }),
  ...signedIn('console', 'complete'),
  ...signedIn('portal', 'not_required'),
]);

export type Session = z.infer<typeof sessionSchema>;
