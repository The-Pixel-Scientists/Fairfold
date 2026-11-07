// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The consent audit: a person's consent history, every choice they made,
// as the party module records it (ADR 0017, ADR 0033). Privacy defines the
// answer only; the server reads it through the party contract and never
// reads party tables. The read is sensitive
// (`privacy.consent_history.viewed`), under `privacy.requests.manage`.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  consentChannelSchema,
  consentPurposeSchema,
  consentStateSchema,
} from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { timestampSchema } from './schemas.ts';

/** Oldest first, each choice with the privacy notice version the person was shown. */
export const consentHistorySchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      purpose: consentPurposeSchema,
      channel: consentChannelSchema,
      state: consentStateSchema,
      privacyNoticeVersion: z.string(),
      recordedAt: timestampSchema,
    }),
  ),
});

export type ConsentHistory = z.infer<typeof consentHistorySchema>;

export const getConsentHistory = defineRoute({
  audience: 'console',
  module: 'privacy',
  permission: 'privacy.requests.manage',
  scope: 'tenant',
  method: 'GET',
  path: '/console/people/:personId/consent-history',
  summary: 'Read every consent choice a person has made, with the notice they were shown',
  params: z.strictObject({ personId: idSchema }),
  responses: { 200: consentHistorySchema },
});

export const consentRoutes = { getConsentHistory } as const;
