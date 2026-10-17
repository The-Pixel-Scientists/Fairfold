// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The funder's 360Giving publisher details (D15), one set per tenant in
// `grants.publisher_setting`, printed in every file it publishes and so all
// public. Saving them records a configuration version (architecture rule
// 10) of entity type `grants.publisher_setting`, whose entity id is the
// row's id and whose diff follows the programme set-up's format with the
// field names as paths, and `grants.publisher_setting.changed`. The
// database checks the same patterns and lengths.

import { z } from 'zod';

import { exportMessages, says } from './messages.ts';

export const publisherSettingConfigEntityType = 'grants.publisher_setting';

/** An org-id.guide identifier: a country, a register and its number, like GB-CHC-1234567. */
const FUNDER_IDENTIFIER = /^[A-Z]{2}-[A-Z0-9]+-[A-Za-z0-9()-]+$/;
/** The prefix 360Giving gives a publisher for its grant identifiers. */
const IDENTIFIER_PREFIX = /^360G-[A-Za-z0-9-]+$/;
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export const publisherSettingInputSchema = z.strictObject({
  funderIdentifier: z
    .string()
    .trim()
    .max(100)
    .refine((value) => FUNDER_IDENTIFIER.test(value), says(exportMessages.funderIdentifier)),
  funderName: z
    .string()
    .trim()
    .max(200)
    .refine((value) => !HIDDEN.test(value), says(exportMessages.hiddenCharacters))
    .refine((value) => value !== '', says(exportMessages.funderName)),
  identifierPrefix: z
    .string()
    .trim()
    .max(50)
    .refine((value) => IDENTIFIER_PREFIX.test(value), says(exportMessages.identifierPrefix)),
});

export type PublisherSettingInput = z.infer<typeof publisherSettingInputSchema>;

export const publisherSettingSchema = z.object({
  funderIdentifier: z.string(),
  funderName: z.string(),
  identifierPrefix: z.string(),
  updatedAt: z.iso.datetime(),
});

export type PublisherSetting = z.infer<typeof publisherSettingSchema>;

/** The tenant's publisher details, or null until an admin saves them. */
export const publisherAnswerSchema = z.object({ publisher: publisherSettingSchema.nullable() });

export type PublisherAnswer = z.infer<typeof publisherAnswerSchema>;
