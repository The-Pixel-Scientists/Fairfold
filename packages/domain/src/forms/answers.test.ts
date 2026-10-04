// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { answersSchema } from './answers.ts';
import { exampleAnswers } from './fixture.ts';

describe('answersSchema', () => {
  it('takes answers of every type keyed by field id', () => {
    expect(answersSchema.parse(exampleAnswers)).toEqual(exampleAnswers);
    expect(answersSchema.safeParse({ f_none: null }).success).toBe(true);
  });

  it('refuses keys that are not field ids, and values of no answer type', () => {
    for (const answers of [
      { tenantId: 'x' },
      { f_Org: 'x' },
      { f_ok: { amountMinor: 1, currency: 'GBP', extra: 1 } },
      { f_ok: { line1: 'a', town: 'b', postcode: 'c', country: 'd' } },
      { f_ok: [1, 2] },
      { f_ok: { nested: { deeper: true } } },
    ]) {
      expect(answersSchema.safeParse(answers).success, JSON.stringify(answers)).toBe(false);
    }
  });
});
