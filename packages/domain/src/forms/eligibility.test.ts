// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkEligibility } from './eligibility.ts';
import { exampleAnswers, exampleForm } from './fixture.ts';

describe('checkEligibility', () => {
  it('is eligible when every shown eligibility question is answered without a stop', () => {
    expect(checkEligibility(exampleForm, exampleAnswers)).toEqual({ status: 'eligible' });
    expect(checkEligibility(exampleForm, { f_charity: true, f_kind: 'equipment' })).toEqual({
      status: 'eligible',
    });
  });

  it('stops on a yes or no answer, or a choice, that stops the applicant, with the reason', () => {
    expect(checkEligibility(exampleForm, { f_charity: false })).toEqual({
      status: 'stopped',
      fieldId: 'f_charity',
      explanation: 'This fund is open to registered charities only.',
    });
    expect(checkEligibility(exampleForm, { f_charity: true, f_kind: 'loans' })).toEqual({
      status: 'stopped',
      fieldId: 'f_kind',
      explanation: 'We cannot pay off loans or other debts.',
    });
  });

  it('stops at the first stop even while another question is unanswered', () => {
    expect(checkEligibility(exampleForm, { f_kind: 'loans' })).toMatchObject({
      status: 'stopped',
      fieldId: 'f_kind',
    });
  });

  it('is incomplete while an eligibility question is unanswered or has no valid answer', () => {
    expect(checkEligibility(exampleForm, {})).toEqual({ status: 'incomplete' });
    expect(checkEligibility(exampleForm, { f_charity: true })).toEqual({ status: 'incomplete' });
    expect(checkEligibility(exampleForm, { f_charity: 'false', f_kind: 'castle' })).toEqual({
      status: 'incomplete',
    });
  });
});
