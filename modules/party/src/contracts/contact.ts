// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Whether a person may be contacted (ADR 0033). The sender asks at the
// moment of sending, for every message, inside the tenant transaction that
// marks the outbox row; a refusal sends nothing and an error in the check
// fails closed. Marketing needs current consent for its purpose and no
// suppression; a transactional message consults hard suppressions only.

import { idSchema, type Id } from '@pixel-scientists/domain';
import { messages } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import {
  consentChannelSchema,
  consentPurposeSchema,
  skipCodeSchema,
  suppressionReasonSchema,
} from './lists.ts';

/** What a message is: a service message, or marketing for one consent purpose. */
export const messageKindSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('transactional') }),
    z.strictObject({ kind: z.literal('marketing'), purpose: consentPurposeSchema }),
  ],
  { error: messages.chooseAllowedValue },
);

export type MessageKind = z.infer<typeof messageKindSchema>;

/** The address is read by the sender through party, never passed in, so no one checks one person and mails another. */
export const mayContactInputSchema = z.strictObject({
  personId: idSchema,
  channel: consentChannelSchema,
  message: messageKindSchema,
});

export type MayContactInput = z.infer<typeof mayContactInputSchema>;

export const mayContactSchema = z.discriminatedUnion('allowed', [
  z.strictObject({ allowed: z.literal(true) }),
  z.strictObject({ allowed: z.literal(false), code: skipCodeSchema }),
]);

export type MayContact = z.infer<typeof mayContactSchema>;

/** A suppression with no purpose covers every marketing purpose on the channel. */
export const suppressionInputSchema = z.strictObject({
  personId: idSchema,
  channel: consentChannelSchema,
  reason: suppressionReasonSchema,
  purpose: consentPurposeSchema.optional(),
});

export type SuppressionInput = z.infer<typeof suppressionInputSchema>;

/**
 * The party server's contact contract. `Ctx` is the caller's request
 * context: the tenant transaction, and the session's member for a staff
 * entry. Suppressions are append-only, so there is no remove: a person's
 * own later consent is what lifts one, and only `bounced` has a release.
 */
export interface PartyContact<Ctx> {
  mayContact(ctx: Ctx, input: MayContactInput): Promise<MayContact>;
  /** Writes `party.suppression.added` and answers the suppression's id. */
  recordSuppression(ctx: Ctx, input: SuppressionInput): Promise<Id>;
}
