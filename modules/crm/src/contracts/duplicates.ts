// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Possible duplicates (ADR 0025). Party computes candidates when staff ask,
// by its named signals; crm lists them as pairs with each signal and a
// strength band, and never the values that matched. A pair is a suggestion:
// nothing links or merges anyone. Staff dismiss a pair with a reason, so it
// is not suggested again. Listing person pairs writes `crm.duplicate.viewed`
// with the party ids. The tenant list is a POST so its filters stay out of
// the URL, as every crm filter does.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  duplicateSignals,
  partyKinds,
  partyKindSchema,
  type DuplicateSignal,
} from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { crmMessages, says } from './messages.ts';
import { choice, cursorSchema, timestampSchema, unique } from './schemas.ts';

/** How strongly a pair looks like one party, strongest first. */
export const scoreBands = ['high', 'medium', 'low'] as const;

export type ScoreBand = (typeof scoreBands)[number];

/** Each signal's band: an exact identifier or email is high, a name alone is low. */
export const signalBands = {
  verified_identifier: 'high',
  email: 'high',
  claimed_identifier: 'medium',
  name_and_postcode: 'medium',
  name_and_organisation: 'medium',
  name: 'low',
} as const satisfies Record<DuplicateSignal, ScoreBand>;

/** A pair's band: that of its strongest signal. */
export function scoreBand(signals: readonly DuplicateSignal[]): ScoreBand {
  const bands = signals.map((signal) => scoreBands.indexOf(signalBands[signal]));
  return scoreBands[Math.min(...bands, scoreBands.length - 1)] ?? 'low';
}

export const dismissReasons = [
  'different_organisation',
  'different_person',
  'related_but_separate',
  'duplicate_allowed',
] as const;

export type DismissReason = (typeof dismissReasons)[number];

/** The lower party id first, so a pair has one form. */
export const duplicatePairSchema = z.strictObject({
  partyId: idSchema,
  otherPartyId: idSchema,
  kind: partyKindSchema,
  signals: z.array(z.enum(duplicateSignals)).min(1),
  band: z.enum(scoreBands),
});

export type DuplicatePair = z.infer<typeof duplicatePairSchema>;

/** Strongest first. `nextCursor` is null on the last page. */
export const duplicatePageSchema = z.strictObject({
  pairs: z.array(duplicatePairSchema),
  nextCursor: cursorSchema.nullable(),
});

export const duplicateQuerySchema = z.strictObject({
  kind: choice(partyKinds, crmMessages.partyKind).optional(),
  signals: z
    .array(choice(duplicateSignals, crmMessages.duplicateSignal))
    .min(1)
    .max(duplicateSignals.length)
    .refine(...unique((signal: string) => signal))
    .optional(),
  cursor: cursorSchema.optional(),
});

export const dismissalInputSchema = z
  .strictObject({
    partyId: idSchema,
    otherPartyId: idSchema,
    reason: choice(dismissReasons, crmMessages.dismissReason),
  })
  .refine(({ partyId, otherPartyId }) => partyId !== otherPartyId, {
    ...says(crmMessages.samePartyTwice),
    path: ['otherPartyId'],
  });

export const dismissalSchema = z.strictObject({
  id: idSchema,
  partyId: idSchema,
  otherPartyId: idSchema,
  reason: z.enum(dismissReasons),
  dismissedAt: timestampSchema,
});

const review = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.duplicates.review',
  scope: 'tenant',
} as const;

export const listDuplicates = defineRoute({
  ...review,
  method: 'POST',
  path: '/console/crm/duplicates/query',
  summary: 'List possible duplicates in the tenant, by kind and signal, strongest first',
  body: duplicateQuerySchema,
  responses: { 200: duplicatePageSchema },
});

export const listPartyDuplicates = defineRoute({
  ...review,
  method: 'GET',
  path: '/console/crm/parties/:partyId/duplicates',
  summary: "List an organisation's or person's possible duplicates, strongest first",
  params: z.strictObject({ partyId: idSchema }),
  responses: { 200: z.strictObject({ pairs: z.array(duplicatePairSchema) }) },
});

export const dismissDuplicate = defineRoute({
  ...review,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/duplicate-dismissals',
  summary: 'Record that two records are not duplicates, with a reason from the list',
  body: dismissalInputSchema,
  responses: { 201: dismissalSchema },
});

export const duplicateRoutes = { listDuplicates, listPartyDuplicates, dismissDuplicate } as const;
