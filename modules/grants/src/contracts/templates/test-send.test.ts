// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { renderTemplate } from '../decisions/email.ts';
import { outcomeIds } from '../programme/lists.ts';
import { defaultEmailTemplates } from '../programme/templates.ts';
import { sampleMergeValues, sendTestEmail, testSendInputSchema } from './test-send.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('the template test send', () => {
  it('keeps every route rule, for members who set up programmes', () => {
    expect(checkRoute(sendTestEmail)).toEqual([]);
    expect(sendTestEmail).toMatchObject({
      audience: 'console',
      module: 'grants',
      permission: 'grants.programmes.manage',
      scope: 'tenant',
      method: 'POST',
      idempotent: true,
      responses: { 202: null },
    });
  });

  it('takes a template version id and no recipient', () => {
    expect(testSendInputSchema.parse({ templateVersionId: ID })).toEqual({ templateVersionId: ID });
    for (const recipient of ['to', 'email', 'cc', 'bcc', 'recipient', 'replyTo']) {
      expect(
        testSendInputSchema.safeParse({ templateVersionId: ID, [recipient]: 'x@example.org' })
          .success,
        recipient,
      ).toBe(false);
    }
  });

  it('fills every default template with sample values', () => {
    for (const outcome of outcomeIds) {
      const email = renderTemplate(
        { outcome, ...defaultEmailTemplates[outcome] },
        sampleMergeValues(outcome),
      );
      expect(email.body, outcome).toContain('Dear Sam,');
      expect(email.body, outcome).not.toMatch(/\{\{|\}\}/);
    }
    expect(
      renderTemplate(
        { outcome: 'accepted', ...defaultEmailTemplates.accepted },
        sampleMergeValues('accepted'),
      ).body,
    ).toContain('£25,000');
  });
});
