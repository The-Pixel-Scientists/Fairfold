// SPDX-License-Identifier: AGPL-3.0-or-later

import { definedEvent, payloadLeafProblems } from '@pixel-scientists/domain/events';
import { isAuditAction } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { formsAuditActions } from './audit.ts';
import { responseSubmitted } from './events.ts';

describe('forms audit actions', () => {
  it('are defined, with submitting, viewing and marking spam on responses', () => {
    for (const action of formsAuditActions) expect(isAuditAction(action)).toBe(true);
    expect(formsAuditActions).toEqual(
      expect.arrayContaining([
        'forms.form.created',
        'forms.form.updated',
        'forms.form_version.published',
        'forms.response.submitted',
        'forms.response.viewed',
        'forms.response.marked_spam',
      ]),
    );
  });
});

describe('forms.response_submitted.v1', () => {
  it('carries ids, the version number and the route only, readable by staff who read responses', () => {
    expect(definedEvent('forms.response_submitted.v1')).toBe(responseSubmitted);
    expect(responseSubmitted.read).toBe('forms.responses.read');
    expect(Object.keys(responseSubmitted.data.shape)).toEqual([
      'responseId',
      'formId',
      'version',
      'route',
    ]);
    expect(payloadLeafProblems(responseSubmitted.data)).toEqual([]);
    expect(
      responseSubmitted.data.safeParse({
        responseId: '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5',
        formId: '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5',
        version: 1,
        route: 'anonymous',
        answers: {},
      }).success,
    ).toBe(false);
  });
});
