// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Passkeys (ADR 0010), always with user verification, so a passkey counts as
// MFA. Each ceremony is two calls: the server answers options holding a
// single-use challenge bound to the caller, then checks the browser's
// credential against it. A passkey can be the first credential of an
// email-first sign-up, sign you in, complete MFA at sign-in, or give step-up.
// Adding and removing one need step-up.
//
// The handlers forward to the passkey plugin's generate-register-options,
// verify-registration, generate-authenticate-options, verify-authentication
// and delete-passkey endpoints behind our own checks (S11-83 confirms the
// names against the pinned plugin); its list and update endpoints stay off
// the allowlist.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { idSchema } from '../id.ts';
import { slugSchema } from '../platform/tenant.ts';
import { passkeyNameSchema, sessionSchema, tokenSchema } from './schemas.ts';
import {
  authenticationSchema,
  creationOptionsSchema,
  registrationSchema,
  requestOptionsSchema,
} from './webauthn.ts';

const common = { audience: 'auth', module: 'platform', permission: null, scope: null } as const;

const change = { ...common, session: 'complete', stepUp: true } as const;

const tenantParams = z.strictObject({ slug: slugSchema });

const passkeySchema = z.object({
  id: idSchema,
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});

export const passkeyRegistrationOptions = defineRoute({
  ...change,
  method: 'POST',
  path: '/auth/passkeys/registration-options',
  summary: 'Start adding a passkey',
  responses: { 200: creationOptionsSchema },
});

export const addPasskey = defineRoute({
  ...change,
  method: 'POST',
  path: '/auth/passkeys',
  summary: 'Add a passkey, with a name to know it by',
  body: z.strictObject({ name: passkeyNameSchema, credential: registrationSchema }),
  responses: { 201: passkeySchema },
});

export const listPasskeys = defineRoute({
  ...common,
  method: 'GET',
  path: '/auth/passkeys',
  summary: 'List your passkeys',
  session: 'complete',
  responses: { 200: z.object({ passkeys: z.array(passkeySchema) }) },
});

export const removePasskey = defineRoute({
  ...change,
  method: 'DELETE',
  path: '/auth/passkeys/:passkeyId',
  summary: 'Remove a passkey',
  params: z.strictObject({ passkeyId: idSchema }),
  responses: { 204: null },
});

/** The sign-up's emailed token finds the address the passkey is for; only the POST below spends it. */
export const signUpPasskeyOptions = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/sign-up/passkey-options',
  summary: 'Start creating the account from a sign-up link, with a passkey',
  session: 'none',
  body: z.strictObject({ token: tokenSchema }),
  responses: { 200: creationOptionsSchema },
});

export const completeSignUpWithPasskey = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/sign-up/complete-passkey',
  summary: 'Create the account from a sign-up link, with a passkey',
  session: 'none',
  body: z.strictObject({
    token: tokenSchema,
    name: passkeyNameSchema,
    credential: registrationSchema,
  }),
  responses: { 204: null },
});

/** A passkey-only account has no password, so a passkey alone signs it in. */
export const passkeySignInOptions = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/tenants/:slug/passkey-sign-in/options',
  summary: 'Start signing in with a passkey',
  session: 'none',
  params: tenantParams,
  responses: { 200: requestOptionsSchema },
});

export const signInWithPasskey = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/tenants/:slug/passkey-sign-in',
  summary: 'Sign in with a passkey',
  session: 'none',
  params: tenantParams,
  body: z.strictObject({ credential: authenticationSchema }),
  responses: { 200: sessionSchema },
});

export const passkeyMfaOptions = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/passkey-mfa/options',
  summary: 'Start completing sign-in with a passkey',
  session: 'mfa_pending',
  responses: { 200: requestOptionsSchema },
});

export const verifyPasskeyMfa = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/passkey-mfa',
  summary: 'Complete sign-in with a passkey',
  session: 'mfa_pending',
  body: z.strictObject({ credential: authenticationSchema }),
  responses: { 200: sessionSchema },
});

export const passkeyStepUpOptions = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/step-up/passkey-options',
  summary: 'Start confirming it is you with a passkey',
  session: 'complete',
  responses: { 200: requestOptionsSchema },
});

export const stepUpWithPasskey = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/step-up/passkey',
  summary: 'Confirm it is you with a passkey before a sensitive action',
  session: 'complete',
  body: z.strictObject({ credential: authenticationSchema }),
  responses: { 200: sessionSchema },
});
