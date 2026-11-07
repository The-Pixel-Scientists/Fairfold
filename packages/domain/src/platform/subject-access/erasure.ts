// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Erasure of one party (ADR 0027). It is a named human action: a member with
// the erasure permission asks, after step-up, with a reason from the list
// below and a literal confirmation; the acting member comes from the session
// (rules 6 and 9). One request names one party. Nothing here erases in bulk,
// on a schedule or past a threshold: only the retention sweep deletes under
// its own rules. A party that is unknown, in another tenant or already
// erased gets the same not-found problem, and a person who is a member of
// staff is refused with `messages.erasureStaffMember`.

import { z } from 'zod';

import { idSchema } from '../../id.ts';
import { messages } from '../messages.ts';
import { failureCodeSchema, tableNameSchema } from './schemas.ts';

export const erasureReasons = ['subject_request', 'tenant_instruction'] as const;

export type ErasureReason = (typeof erasureReasons)[number];

export const erasureRequestSchema = z.strictObject({
  partyId: idSchema,
  reason: z.enum(erasureReasons, { error: messages.erasureReason }),
  confirm: z.literal(true, { error: messages.erasureConfirm }),
});

export type ErasureRequest = z.infer<typeof erasureRequestSchema>;

/** How many rows of each table were anonymised or removed: counts and nothing else. */
export const erasureCountsSchema = z.record(tableNameSchema, z.int().min(0));

export type ErasureCounts = z.infer<typeof erasureCountsSchema>;

export const erasureStatuses = ['queued', 'running', 'done', 'failed'] as const;

const requested = { id: idSchema, requestedAt: z.iso.datetime() };

/** An erasure request as members with the erasure permission read it. It names no one. */
export const erasureStatusSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...requested, status: z.enum(['queued', 'running']) }),
  z.strictObject({ ...requested, status: z.literal('done'), counts: erasureCountsSchema }),
  z.strictObject({ ...requested, status: z.literal('failed'), failureCode: failureCodeSchema }),
]);

export type ErasureStatus = z.infer<typeof erasureStatusSchema>;
