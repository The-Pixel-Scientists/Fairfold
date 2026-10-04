// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Accepting an invitation to a tenant's team (ADR 0010). The invited person
// first signs up or signs in, with MFA, at the tenant's address; only a
// complete session reaches this route, and the token is spent by a POST.
// Every refusal answers the same way, whatever the reason.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { sessionSchema, tokenSchema } from './schemas.ts';

export const acceptInvitation = defineRoute({
  audience: 'auth',
  module: 'platform',
  permission: null,
  scope: null,
  method: 'POST',
  path: '/auth/invitations/accept',
  summary: 'Accept an invitation and join the team with its roles',
  session: 'complete',
  body: z.strictObject({ token: tokenSchema }),
  responses: { 200: sessionSchema },
});
