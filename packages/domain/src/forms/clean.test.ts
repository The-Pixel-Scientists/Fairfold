// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { cleanAnswers, isBlankText } from './clean.ts';
import { exampleAnswers, exampleForm } from './fixture.ts';
import { formMessages as m } from './messages.ts';
import { validateAnswers } from './validate.ts';

const INVISIBLE = ['​', '‌', '‍', '⁠', '﻿', '­'];

describe('isBlankText', () => {
  it('treats whitespace and invisible format characters as blank', () => {
    for (const value of ['', '   ', '\n\t', ...INVISIBLE, ` ${INVISIBLE.join('')} `]) {
      expect(isBlankText(value)).toBe(true);
    }
  });

  it('keeps text with any visible character', () => {
    for (const value of ['a', '​a​', '0', '.']) expect(isBlankText(value)).toBe(false);
  });
});

describe('cleanAnswers', () => {
  it('stores no-answers as null', () => {
    const cleaned = cleanAnswers(exampleForm, {
      f_orgname: '​⁠ ',
      f_works: '',
      f_kind: '﻿',
      f_groups: [],
      f_people: null,
    });
    expect(cleaned).toEqual({
      f_orgname: null,
      f_works: null,
      f_kind: null,
      f_groups: null,
      f_people: null,
    });
  });

  it('keeps real answers exactly as given, with nothing trimmed', () => {
    const answers = { ...exampleAnswers, f_orgname: '  Northfield​ ', f_charity: false };
    expect(cleanAnswers(exampleForm, answers)).toEqual(answers);
  });

  it('leaves keys that are not questions for validation to refuse', () => {
    const cleaned = cleanAnswers(exampleForm, { f_unknown: '', f_intro: '' });
    expect(cleaned).toEqual({ f_unknown: '', f_intro: '' });
    expect(validateAnswers(exampleForm, cleaned, 'draft')).toEqual([
      { field: 'f_unknown', message: m.notOnForm },
      { field: 'f_intro', message: m.notOnForm },
    ]);
  });

  it('does not change the answers it is given', () => {
    const answers = { f_orgname: '​' };
    cleanAnswers(exampleForm, answers);
    expect(answers).toEqual({ f_orgname: '​' });
  });
});

describe('the no-answer rule in validateAnswers', () => {
  it('refuses a required question answered only with invisible characters on submit', () => {
    for (const value of INVISIBLE) {
      const answers = { ...exampleAnswers, f_orgname: value };
      const expected = [{ field: 'f_orgname', message: m.enterAnswer }];
      expect(validateAnswers(exampleForm, answers, 'submit')).toEqual(expected);
      expect(validateAnswers(exampleForm, cleanAnswers(exampleForm, answers), 'submit')).toEqual(
        expected,
      );
    }
  });

  it('refuses an address line made only of invisible characters', () => {
    const f_address = { line1: '​', town: '⁠', postcode: 'NF1 1AA' };
    expect(validateAnswers(exampleForm, { ...exampleAnswers, f_address }, 'submit')).toEqual([
      { field: 'f_address.line1', message: m.addressLine1 },
      { field: 'f_address.town', message: m.addressTown },
    ]);
  });
});
