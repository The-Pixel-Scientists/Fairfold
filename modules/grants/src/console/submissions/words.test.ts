import { describe, expect, it } from 'vitest';

import { eventText } from './detail/HistoryTab.tsx';
import { countOf, formatDay, nextStep } from './words.tsx';

describe('nextStep', () => {
  it('says what a person has to do, from what staff can see', () => {
    expect(nextStep({ status: 'submitted', eligibility: null })).toBe('Check eligibility');
    expect(nextStep({ status: 'submitted', eligibility: 'stopped' })).toBe(
      'Check why it is not eligible',
    );
    expect(nextStep({ status: 'submitted', eligibility: 'eligible' })).toBe('Ready to move on');
  });

  it('says nothing needs doing for a withdrawn submission, whatever its eligibility', () => {
    expect(nextStep({ status: 'withdrawn', eligibility: 'stopped' })).toBe(
      'Nothing: the applicant withdrew it',
    );
  });
});

describe('countOf', () => {
  it('uses the singular for one only', () => {
    expect([0, 1, 2].map(countOf)).toEqual(['0 submissions', '1 submission', '2 submissions']);
  });
});

describe('formatDay', () => {
  it('writes a day as the style guide does', () => {
    expect(formatDay('2027-04-01T12:00:00.000Z')).toBe('1 April 2027');
  });
});

describe('eventText', () => {
  const at = '2027-04-01T12:00:00.000Z';
  const intake = { id: 'a', name: 'Intake' };
  const review = { id: 'b', name: 'Review' };

  it('says each kind of change', () => {
    expect(eventText({ event: 'submitted', at, by: null })).toBe('Submitted');
    expect(eventText({ event: 'withdrawn', at, by: null })).toBe('Withdrawn by the applicant');
    expect(eventText({ event: 'stage_changed', at, by: null, from: null, to: intake })).toBe(
      'Entered Intake',
    );
    expect(eventText({ event: 'stage_changed', at, by: null, from: intake, to: review })).toBe(
      'Moved from Intake to Review',
    );
  });
});
