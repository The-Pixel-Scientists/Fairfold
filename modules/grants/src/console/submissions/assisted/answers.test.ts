// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseDefinition } from '@pixel-scientists/domain/forms';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { controlId, progress, questionOf, savable, toFix } from './answers.ts';

const parsed = parseDefinition({
  sections: [
    {
      id: 's_one',
      title: 'About you',
      fields: [
        { id: 'f_email', type: 'email', label: 'Email', required: true },
        { id: 'f_charity', type: 'yes_no', label: 'Charity', required: true },
        {
          id: 'f_more',
          type: 'short_text',
          label: 'More',
          required: true,
          conditions: [{ field: 'f_charity', equals: true }],
        },
        { id: 'f_story', type: 'long_text', label: 'Story', required: true, maxWords: 50 },
        {
          id: 'f_accounts',
          type: 'file',
          label: 'Accounts',
          required: true,
          allowedTypes: ['application/pdf'],
          maxBytes: 1024 * 1024,
          maxFiles: 1,
        },
      ],
    },
  ],
});
if (!parsed.success) throw new Error('The test definition is not valid.');
const definition: FormDefinition = parsed.data;

describe('what is saved', () => {
  it('sends the shown answers that have one, and leaves out blanks and questions that are hidden', () => {
    const { body, held } = savable(
      definition,
      { f_email: 'b@example.org', f_story: '  ', f_charity: false, f_more: 'hidden answer' },
      {},
    );
    expect(body).toEqual({ f_email: 'b@example.org', f_charity: false });
    expect(held).toEqual([]);
  });

  it('keeps the answer saved before when the new one cannot be saved yet', () => {
    const { body, held } = savable(
      definition,
      { f_email: 'a@exam', f_story: 'Words.' },
      { f_email: 'a@example.org' },
    );
    expect(body).toEqual({ f_email: 'a@example.org', f_story: 'Words.' });
    expect(held).toEqual(['f_email']);
  });

  it('never sends a file question, which this route cannot take', () => {
    expect(savable(definition, { f_accounts: ['x'] }, {}).body).toEqual({});
  });
});

describe('what is left to do', () => {
  it('lists required questions with no answer, and none for hidden or file questions', () => {
    expect(
      toFix(definition, { f_email: 'b@example.org', f_charity: false }).map(questionOf),
    ).toEqual(['f_story']);
    expect(
      toFix(definition, { f_email: 'b@example.org', f_charity: true, f_story: 'Words.' }).map(
        questionOf,
      ),
    ).toEqual(['f_more']);
  });

  it('counts answered questions out of those shown', () => {
    expect(progress(definition, { f_email: 'b@example.org' })).toEqual([1, 3]);
    expect(
      progress(definition, { f_email: 'b@example.org', f_charity: true, f_story: 'Words.' }),
    ).toEqual([3, 4]);
  });

  it('finds the control a problem is about', () => {
    expect(controlId({ field: 'f_story', message: '' })).toBe('f_story');
    expect(controlId({ field: 'f_address.town', message: '' })).toBe('f_address-town');
    expect(controlId({ field: 'f_address.line1', message: '' })).toBe('f_address');
    expect(controlId({ field: 'f_costs.2.c_cost', message: '' })).toBe('f_costs-2-c_cost');
  });
});
