// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The MVP1 MFA routes (ADR 0010): setting up and using an authenticator app,
// and step-up. Only a session waiting for MFA reaches the TOTP routes, so a
// complete session can neither swap the authenticator nor guess codes, and
// applicants, who are never asked for MFA in MVP1, cannot enrol. Changing an
// authenticator from a complete session will be its own step-up route.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { currentPasswordSchema, sessionSchema, totpCodeSchema } from './schemas.ts';

const common = { audience: 'auth', module: 'platform', permission: null, scope: null } as const;

export const enrolTotp = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/totp/enrol',
  summary: 'Start setting up an authenticator app',
  session: 'mfa_pending',
  responses: {
    200: z.object({
      /** To type into the app. Always shown beside the QR code. */
      key: z.string(),
      /** An `otpauth://` URI for the QR code. */
      uri: z.string(),
    }),
  },
});

export const confirmTotp = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/totp/confirm',
  summary: 'Finish setting up an authenticator app with its first code',
  session: 'mfa_pending',
  body: z.strictObject({ code: totpCodeSchema }),
  responses: { 200: sessionSchema },
});

export const verifyTotp = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/totp/verify',
  summary: 'Complete sign-in with a code from an authenticator app',
  session: 'mfa_pending',
  body: z.strictObject({ code: totpCodeSchema }),
  responses: { 200: sessionSchema },
});

export const stepUp = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/step-up',
  summary: 'Confirm it is you before a sensitive action',
  session: 'complete',
  body: z.strictObject({ password: currentPasswordSchema, code: totpCodeSchema }),
  responses: { 200: sessionSchema },
});
