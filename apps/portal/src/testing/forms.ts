// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: a funder's public form and a browser check, built through the
// forms contracts so a fixture cannot drift from them. Synthetic data only.
// Not part of the app.

import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { proofChallengeResponseSchema, publicFormSchema } from '@pixel-scientists/forms/contracts';

export const FORM_ID = '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70';

export const publicForm = () =>
  publicFormSchema.parse({
    formId: FORM_ID,
    formVersionId: '7c1d3e5f-9a2b-4c4d-8e6f-0a1b2c3d4e5f',
    title: 'Funder A feedback',
    description: 'Tell Funder A how we did.',
    definition: formDefinitionSchema.parse({
      sections: [
        {
          id: 's_you',
          title: 'About you',
          fields: [{ id: 'f_name', type: 'short_text', label: 'Your name', required: true }],
        },
      ],
    }),
    noProofFallback: true,
  });

export const challengeReply = () =>
  proofChallengeResponseSchema.parse({
    challenge: `${'a'.repeat(60)}.${'b'.repeat(42)}A`,
    difficulty: 8,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
