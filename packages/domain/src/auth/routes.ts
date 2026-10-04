// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The first release's auth routes (ADR 0010): email-first sign-up, password
// sign-in and reset, sign-out, the session and switching tenant, with the
// MFA routes from mfa-routes.ts and accepting an invitation from
// invitation-routes.ts. They have no permission or scope: each states the
// session it needs instead. Requests that start a sign-up or a password
// reset answer the same way whether or not the address has an account, and
// emailed links carry a token that only a POST spends.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { idSchema } from '../id.ts';
import { slugSchema } from '../platform/tenant.ts';
import { acceptInvitation } from './invitation-routes.ts';
import { confirmTotp, enrolTotp, stepUp, verifyTotp } from './mfa-routes.ts';
import {
  currentPasswordSchema,
  emailSchema,
  passwordSchema,
  sessionSchema,
  tokenSchema,
} from './schemas.ts';

const tenantParams = z.strictObject({ slug: slugSchema });

const common = { audience: 'auth', module: 'platform', permission: null, scope: null } as const;

export const startSignUp = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/tenants/:slug/sign-up',
  summary: 'Email a sign-up link',
  session: 'none',
  params: tenantParams,
  body: z.strictObject({ email: emailSchema }),
  responses: { 202: null },
});

export const completeSignUp = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/sign-up/complete',
  summary: 'Create the account from a sign-up link, with its password',
  session: 'none',
  body: z.strictObject({ token: tokenSchema, password: passwordSchema }),
  responses: { 204: null },
});

export const signIn = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/tenants/:slug/sign-in',
  summary: 'Sign in with an email address and password',
  session: 'none',
  params: tenantParams,
  body: z.strictObject({ email: emailSchema, password: currentPasswordSchema }),
  responses: { 200: sessionSchema },
});

export const signOut = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/sign-out',
  summary: 'Sign out',
  session: 'any',
  responses: { 204: null },
});

export const getSession = defineRoute({
  ...common,
  method: 'GET',
  path: '/auth/session',
  summary: 'Read the current session',
  session: 'any',
  responses: { 200: sessionSchema },
});

export const switchTenant = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/switch-tenant',
  summary: 'Switch to another of your memberships',
  session: 'complete',
  body: z.strictObject({ membershipId: idSchema }),
  responses: { 200: sessionSchema },
});

export const requestPasswordReset = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/tenants/:slug/password-reset',
  summary: 'Email a password reset link',
  session: 'none',
  params: tenantParams,
  body: z.strictObject({ email: emailSchema }),
  responses: { 202: null },
});

export const completePasswordReset = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/password-reset/complete',
  summary: 'Set a new password from a reset link',
  session: 'none',
  body: z.strictObject({ token: tokenSchema, password: passwordSchema }),
  responses: { 204: null },
});

/** Every auth route. None has a permission, so each is listed here for the API's checks. */
export const authRoutes = {
  startSignUp,
  completeSignUp,
  signIn,
  enrolTotp,
  confirmTotp,
  verifyTotp,
  stepUp,
  signOut,
  getSession,
  switchTenant,
  requestPasswordReset,
  completePasswordReset,
  acceptInvitation,
} as const;
