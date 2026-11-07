// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changes to your own account from a complete session (ADR 0010), each after
// step-up: the authenticator app, for staff replacing one and applicants
// adding one; the email address; and the password. An MFA change signs you
// out everywhere, so its routes answer 204 and the app returns to sign-in.
// A password or email change signs out your other sessions. The new address
// is proven by an emailed link, which opens a page that changes nothing; its
// POST spends the token.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { emailSchema, passwordSchema, tokenSchema, totpCodeSchema } from './schemas.ts';

const common = { audience: 'auth', module: 'platform', permission: null, scope: null } as const;

const change = { ...common, session: 'complete', stepUp: true } as const;

/**
 * The page an email change link opens, under the app's tenant address, with
 * the token after `#token=` so no server sees it. The server builds the link
 * from it and the apps route it.
 */
export const emailChangeLinkPath = '/email-change';

export const startTotpChange = defineRoute({
  ...change,
  method: 'POST',
  path: '/auth/account/totp/start',
  summary: 'Start setting up a new authenticator app',
  responses: {
    200: z.object({
      /** To type into the app. Always shown beside the QR code. */
      key: z.string(),
      /** An `otpauth://` URI for the QR code. */
      uri: z.string(),
    }),
  },
});

export const confirmTotpChange = defineRoute({
  ...change,
  method: 'POST',
  path: '/auth/account/totp/confirm',
  summary: 'Finish setting up a new authenticator app, which signs you out everywhere',
  body: z.strictObject({ code: totpCodeSchema }),
  responses: { 204: null },
});

export const removeTotp = defineRoute({
  ...change,
  method: 'DELETE',
  path: '/auth/account/totp',
  summary: 'Remove your authenticator app, which signs you out everywhere',
  responses: { 204: null },
});

/** The same answer whether or not the new address already has an account. */
export const requestEmailChange = defineRoute({
  ...change,
  method: 'POST',
  path: '/auth/account/email',
  summary: 'Change your email address: email a link to the new one',
  body: z.strictObject({ email: emailSchema }),
  responses: { 202: null },
});

export const completeEmailChange = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/email-change/complete',
  summary: 'Change your email address from the link sent to it',
  session: 'none',
  body: z.strictObject({ token: tokenSchema }),
  responses: { 204: null },
});

export const changePassword = defineRoute({
  ...change,
  method: 'POST',
  path: '/auth/account/password',
  summary: 'Change your password, which signs out your other sessions',
  body: z.strictObject({ password: passwordSchema }),
  responses: { 204: null },
});
