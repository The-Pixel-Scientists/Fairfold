// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Backup codes (ADR 0010): 10 single-use codes, stored as HMACs and shown
// only when generated. Our own route verifies them; Better Auth's
// verify-backup-code stays off the allowlist, and its generate-backup-codes
// is called only behind generateBackupCodes.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { backupCodeSchema, sessionSchema } from './schemas.ts';

const common = { audience: 'auth', module: 'platform', permission: null, scope: null } as const;

export const generateBackupCodes = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/backup-codes',
  summary: 'Make new backup codes, replacing any you had, and show them once',
  session: 'complete',
  stepUp: true,
  responses: { 200: z.object({ codes: z.array(backupCodeSchema).length(10) }) },
});

export const countBackupCodes = defineRoute({
  ...common,
  method: 'GET',
  path: '/auth/backup-codes',
  summary: 'Read how many backup codes you have left',
  session: 'complete',
  responses: { 200: z.object({ remaining: z.int().min(0).max(10) }) },
});

export const verifyBackupCode = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/backup-codes/verify',
  summary: 'Complete sign-in with a backup code, which then stops working',
  session: 'mfa_pending',
  body: z.strictObject({ code: backupCodeSchema }),
  responses: { 200: sessionSchema },
});
