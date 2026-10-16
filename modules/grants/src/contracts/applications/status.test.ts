// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { outcomeIds } from '../programme/lists.ts';
import { applicationStatuses } from './lists.ts';
import {
  applicantOutcome,
  applicantStatus,
  applicantStatuses,
  type ApplicantDecision,
} from './status.ts';

const award = { amountMinor: 1_250_000, currency: 'GBP' } as const;

function decision(outcome: ApplicantDecision['outcome'], released: boolean): ApplicantDecision {
  return { outcome, amount: outcome === 'accepted' ? award : null, released };
}

/** Every decision an application can have that is not released, and none. */
const unreleased = [null, ...outcomeIds.map((outcome) => decision(outcome, false))];

describe('applicantStatus', () => {
  it('names a draft, a withdrawn and a submitted application', () => {
    const none = { inFirstStage: false, decision: null };
    expect(applicantStatus({ ...none, status: 'draft' })).toBe('in_progress');
    expect(applicantStatus({ ...none, status: 'withdrawn' })).toBe('withdrawn');
    expect(applicantStatus({ ...none, status: 'submitted', inFirstStage: true })).toBe('submitted');
    expect(applicantStatus({ ...none, status: 'submitted' })).toBe('under_review');
  });

  it('gives the outcome once the decision is released', () => {
    const status = (outcome: ApplicantDecision['outcome']) =>
      applicantStatus({
        status: 'submitted',
        inFirstStage: false,
        decision: decision(outcome, true),
      });
    expect(outcomeIds.map(status)).toEqual(['awarded', 'waitlisted', 'not_funded']);
  });

  it('never says more than "Submitted" or "Under review" before release, whatever else is true', () => {
    const labels = new Set<string>();
    for (const status of applicationStatuses) {
      for (const inFirstStage of [true, false]) {
        for (const recorded of unreleased) {
          labels.add(
            applicantStatuses[applicantStatus({ status, inFirstStage, decision: recorded })],
          );
        }
      }
    }
    expect([...labels].sort()).toEqual(['In progress', 'Submitted', 'Under review', 'Withdrawn']);
  });

  it('has labels in sentence case', () => {
    expect(Object.values(applicantStatuses)).toEqual([
      'In progress',
      'Submitted',
      'Under review',
      'Awarded',
      'On the waiting list',
      'Not funded',
      'Withdrawn',
    ]);
  });
});

describe('applicantOutcome', () => {
  it('is null until the decision is released', () => {
    for (const recorded of unreleased) expect(applicantOutcome(recorded)).toBeNull();
  });

  it('gives the outcome once released, with the amount for an award only', () => {
    expect(outcomeIds.map((outcome) => applicantOutcome(decision(outcome, true)))).toEqual([
      { result: 'accepted', amount: award },
      { result: 'waitlisted' },
      { result: 'declined' },
    ]);
  });

  it('refuses a released award with no amount', () => {
    expect(() => applicantOutcome({ outcome: 'accepted', amount: null, released: true })).toThrow();
  });
});
