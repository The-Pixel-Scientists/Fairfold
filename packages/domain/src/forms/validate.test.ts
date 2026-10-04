// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messages } from '../platform/messages.ts';
import { exampleAnswers, exampleForm } from './fixture.ts';
import { formMessages as m } from './messages.ts';
import { formDefinitionSchema } from './rules.ts';
import { validateAnswers } from './validate.ts';

/** Problems with the example answers after one change, in submit mode. */
function withAnswer(id: string, value: unknown, mode: 'draft' | 'submit' = 'submit') {
  return validateAnswers(exampleForm, { ...exampleAnswers, [id]: value }, mode);
}

const problem = (field: string, message: string) => [{ field, message }];

describe('validateAnswers', () => {
  it('passes complete, valid answers in both modes', () => {
    expect(validateAnswers(exampleForm, exampleAnswers, 'submit')).toEqual([]);
    expect(validateAnswers(exampleForm, exampleAnswers, 'draft')).toEqual([]);
  });

  it('checks required questions only on submit, and only those shown', () => {
    expect(validateAnswers(exampleForm, {}, 'draft')).toEqual([]);
    const submitted = validateAnswers(exampleForm, {}, 'submit');
    expect(submitted).toEqual([
      { field: 'f_charity', message: m.chooseAnswer },
      { field: 'f_orgname', message: m.enterAnswer },
      { field: 'f_email', message: m.enterAnswer },
      { field: 'f_kind', message: m.chooseAnswer },
      { field: 'f_amount', message: m.enterAnswer },
    ]);
    // f_works is required but hidden until building work is chosen.
    expect(submitted.map((p) => p.field)).not.toContain('f_works');
  });

  it('counts null, a blank string and an empty list as no answer only where the type allows', () => {
    for (const value of [null, '', '   ', undefined]) {
      expect(withAnswer('f_orgname', value)).toEqual(problem('f_orgname', m.enterAnswer));
      expect(withAnswer('f_orgname', value, 'draft')).toEqual([]);
    }
    for (const id of ['f_start', 'f_email', 'f_phone', 'f_site', 'f_region']) {
      expect(withAnswer(id, '', 'draft'), id).toEqual([]);
    }
    for (const id of ['f_people', 'f_amount', 'f_address', 'f_groups']) {
      expect(withAnswer(id, null, 'draft'), id).toEqual([]);
    }
    expect(withAnswer('f_groups', [])).toEqual([]);
  });

  it('refuses an empty value of the wrong type, even on an optional question', () => {
    for (const mode of ['draft', 'submit'] as const) {
      expect(withAnswer('f_people', [], mode)).toEqual(problem('f_people', messages.enterNumber));
      expect(withAnswer('f_people', '   ', mode)).toEqual(
        problem('f_people', messages.enterNumber),
      );
      expect(withAnswer('f_amount', '', mode)).toEqual(problem('f_amount', messages.currency));
      expect(withAnswer('f_amount', [], mode)).toEqual(problem('f_amount', messages.currency));
      expect(withAnswer('f_address', [], mode)).toEqual(problem('f_address', m.address));
      expect(withAnswer('f_address', '', mode)).toEqual(problem('f_address', m.address));
      expect(withAnswer('f_charity', '', mode)).toEqual(problem('f_charity', m.yesOrNo));
      expect(withAnswer('f_orgname', [], mode)).toEqual(problem('f_orgname', messages.enterText));
      expect(withAnswer('f_start', [], mode)).toEqual(problem('f_start', m.realDate));
      expect(withAnswer('f_region', [], mode)).toEqual(problem('f_region', m.chooseOption));
    }
  });

  it('refuses answers to questions not on the form, naming only id-shaped keys', () => {
    const answers = { ...exampleAnswers, f_other: 'x', f_intro: 'x', 'tenantId <b>': 'x' };
    expect(validateAnswers(exampleForm, answers, 'draft')).toEqual([
      { field: 'f_other', message: m.notOnForm },
      { field: 'f_intro', message: m.notOnForm },
      { field: '*', message: m.notOnForm },
    ]);
  });

  it('refuses an answer to a question that is not shown', () => {
    const answers = { ...exampleAnswers, f_kind: 'equipment' };
    expect(validateAnswers(exampleForm, answers, 'draft')).toEqual([
      { field: 'f_works', message: m.notShown },
      { field: 'f_planning', message: m.notShown },
    ]);
    const cleared = { ...answers, f_works: '', f_planning: null };
    expect(validateAnswers(exampleForm, cleared, 'submit')).toEqual([]);
  });

  it('refuses answers that are not an object', () => {
    for (const answers of [null, [], 'answers', 42]) {
      expect(validateAnswers(exampleForm, answers, 'draft')).toEqual(
        problem('*', messages.sendObject),
      );
    }
  });

  it('converts nothing: each answer must already have its field type', () => {
    expect(withAnswer('f_orgname', 42)).toEqual(problem('f_orgname', messages.enterText));
    expect(withAnswer('f_people', '250')).toEqual(problem('f_people', messages.enterNumber));
    expect(withAnswer('f_charity', 'true')).toEqual(problem('f_charity', m.yesOrNo));
    expect(withAnswer('f_charity', 1)).toEqual(problem('f_charity', m.yesOrNo));
    expect(withAnswer('f_amount', 15_000)).toEqual(problem('f_amount', messages.currency));
    expect(withAnswer('f_groups', 'young')).toEqual(problem('f_groups', m.chooseOption));
  });

  it('checks short and long text limits, in words and characters', () => {
    expect(withAnswer('f_orgname', 'x'.repeat(121))).toEqual(
      problem('f_orgname', m.tooManyCharacters(120, 121)),
    );
    expect(withAnswer('f_orgname', 'Two\nlines')).toEqual(problem('f_orgname', m.oneLine));
    expect(withAnswer('f_works', 'word '.repeat(263))).toEqual(
      problem('f_works', 'Enter 250 words or fewer. You have 263.'),
    );
    expect(withAnswer('f_works', 'word '.repeat(250))).toEqual([]);
    expect(withAnswer('f_works', 'x'.repeat(20_001))).toEqual(
      problem('f_works', 'Enter 20,000 characters or fewer. You have 20,001.'),
    );
  });

  it('checks numbers: finite, whole when asked, and in range', () => {
    expect(withAnswer('f_people', 2.5)).toEqual(problem('f_people', messages.enterWholeNumber));
    expect(withAnswer('f_people', 0)).toEqual(problem('f_people', m.numberBetween(1, 100_000)));
    expect(withAnswer('f_people', 100_001)).toEqual(
      problem('f_people', 'Enter a number from 1 to 100,000.'),
    );
    expect(withAnswer('f_people', Number.NaN)).toEqual(problem('f_people', messages.enterNumber));
  });

  it('checks amounts as whole pence in range, never below zero', () => {
    const pence = (amountMinor: unknown, currency: unknown = 'GBP') =>
      withAnswer('f_amount', { amountMinor, currency });
    const range = problem('f_amount', 'Enter an amount from £5,000 to £25,000.');
    expect(pence(499_999)).toEqual(range);
    expect(pence(2_500_001)).toEqual(range);
    expect(pence(-1)).toEqual(range);
    expect(pence(500_000.5)).toEqual(problem('f_amount', messages.currency));
    expect(pence(1_000_000, 'USD')).toEqual(problem('f_amount', messages.currency));
    expect(withAnswer('f_amount', { amountMinor: 1_000_000, currency: 'GBP', note: 'x' })).toEqual(
      problem('f_amount', messages.currency),
    );
  });

  it('checks dates are real', () => {
    for (const date of ['2027-02-29', '2027-13-01', '2027-1-1', '1 April 2027', 20270401]) {
      expect(withAnswer('f_start', date), String(date)).toEqual(problem('f_start', m.realDate));
    }
    expect(withAnswer('f_start', '2028-02-29')).toEqual([]);
  });

  it('checks email addresses, phone numbers and https web addresses', () => {
    expect(withAnswer('f_email', 'not an address')).toEqual(problem('f_email', messages.email));
    expect(withAnswer('f_phone', '+44 7700 900 982')).toEqual([]);
    for (const phone of ['12345', 'call me', '+44 7700 900 982 0000 000']) {
      expect(withAnswer('f_phone', phone), phone).toEqual(problem('f_phone', m.phone));
    }
    for (const site of ['http://northfield.example', 'https://localhost', 'javascript:alert(1)']) {
      expect(withAnswer('f_site', site), site).toEqual(problem('f_site', m.webAddress));
    }
  });

  it('checks choices are options, once each, within the selection limits', () => {
    // An answer that is not an option also hides the questions it controls.
    expect(withAnswer('f_kind', 'castle')).toEqual([
      { field: 'f_kind', message: m.chooseOption },
      { field: 'f_works', message: m.notShown },
      { field: 'f_planning', message: m.notShown },
    ]);
    expect(withAnswer('f_region', 'east')).toEqual(problem('f_region', m.chooseOption));
    expect(withAnswer('f_groups', ['young', 'young'])).toEqual(
      problem('f_groups', m.chooseEachOnce),
    );
    expect(withAnswer('f_groups', ['young', 'older', 'families'])).toEqual(
      problem('f_groups', 'Choose no more than 2 options.'),
    );
    expect(withAnswer('f_groups', ['young', 'other'])).toEqual(problem('f_groups', m.chooseOption));
  });

  it('checks each part of a UK address', () => {
    expect(withAnswer('f_address', { line1: ' ', town: '', postcode: 'NOPE' })).toEqual([
      { field: 'f_address.line1', message: m.addressLine1 },
      { field: 'f_address.town', message: m.addressTown },
      { field: 'f_address.postcode', message: m.postcode },
    ]);
    for (const address of [
      { line1: '1 High Street', town: 'Northfield' },
      { line1: '1 High Street', town: 'Northfield', postcode: 'NF1 1AA', country: 'X' },
      { line1: 'x'.repeat(101), town: 'Northfield', postcode: 'NF1 1AA' },
      'NF1 1AA',
    ]) {
      expect(withAnswer('f_address', address)).toEqual(problem('f_address', m.address));
    }
    expect(
      withAnswer('f_address', { line1: '1 Road', town: 'Leeds', postcode: 'ls1 4ap' }),
    ).toEqual([]);
  });

  it('asks for at least the minimum selections when a required multiple choice is empty', () => {
    const form = formDefinitionSchema.parse({
      sections: [
        {
          id: 's_one',
          title: 'One',
          fields: [
            {
              id: 'f_who',
              type: 'multiple_choice',
              label: 'Who?',
              required: true,
              minSelections: 2,
              options: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ],
            },
          ],
        },
      ],
    });
    expect(validateAnswers(form, { f_who: [] }, 'submit')).toEqual(
      problem('f_who', 'Choose at least 2 options.'),
    );
    expect(validateAnswers(form, { f_who: ['a'] }, 'draft')).toEqual(
      problem('f_who', 'Choose at least 2 options.'),
    );
  });
});
