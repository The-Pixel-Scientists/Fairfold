// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending a test of an outcome email template (E9, ADR 0033), so a member
// who sets up programmes sees the email as it arrives. The request names a
// saved template version and nothing else: the email goes only to the
// signed-in member's own address, which the server reads from the session
// (rule 6), so no request can send tenant-branded mail to anyone else.
//
// The rules the server (S12-39) holds:
// - the template version is one of the tenant's; any other answers 404;
// - its merge fields are filled from sampleMergeValues() through
//   renderTemplate() and its allowlist, never from a real application;
// - the email is a service email, its subject marked as a test, and it is
//   recorded as `grants.email_template.test_sent` with the template version
//   id, never the address or the text;
// - each member sends at most TEST_SENDS_PER_HOUR tests an hour; past that
//   the server answers 429.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import type { MergeValues } from '../decisions/email.ts';
import type { Outcome } from '../programme/lists.ts';

export const TEST_SENDS_PER_HOUR = 10;

export const testSendInputSchema = z.strictObject({ templateVersionId: idSchema });

export type TestSendInput = z.infer<typeof testSendInputSchema>;

/** Made-up values for a test email: no real applicant, organisation or award. */
export function sampleMergeValues(outcome: Outcome): MergeValues {
  return {
    givenName: 'Sam',
    organisationName: 'Example Community Trust',
    programmeTitle: 'Example programme',
    roundTitle: 'Example round',
    portalLink: 'https://portal.example.org',
    amount: outcome === 'accepted' ? { amountMinor: 2_500_000, currency: 'GBP' } : null,
  };
}

export const sendTestEmail = defineRoute({
  audience: 'console',
  module: 'grants',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
  method: 'POST',
  idempotent: true,
  path: '/console/email-templates/test-sends',
  summary: 'Send test email to me, filled with sample values',
  body: testSendInputSchema,
  responses: { 202: null },
});

export const templateRoutes = { sendTestEmail } as const;
