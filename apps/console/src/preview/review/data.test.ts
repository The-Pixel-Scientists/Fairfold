// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { applications, reviewers } from '../story.ts';
import { answers as staffAnswers, budget, otherFunding, staffForm } from './featured.ts';
import { answers as blindAnswers, requested as blindRequested, reviewerForm } from './blind.ts';
import { WIDE_SPREAD, nextStep, range, rows } from './data.ts';
import { assignments } from './inbox.ts';
import { breakdown, reviewScores, weightedTotal } from './scoring.ts';

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

const reviewedBy = (name: string) =>
  applications.flatMap((application) =>
    application.reviews.flatMap((review, position) =>
      review.reviewer === name ? [{ application, position }] : [],
    ),
  );

describe('the round', () => {
  it('has the numbers the other previews give', () => {
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    expect(rows).toHaveLength(48);
    expect(sum(rows.map((row) => row.requested))).toBe(612_400);
    expect(rows.filter((row) => row.eligibility === 'Passed')).toHaveLength(41);
    expect(count('In review')).toBe(30);
    expect(count('Shortlisted')).toBe(11);
    expect(count('Ineligible')).toBe(7);
    expect(count('Submitted')).toBe(0);
  });

  it('holds 123 reviews, 95 of them submitted, 40 applications reviewed and 2 wide spreads', () => {
    expect(sum(rows.map((row) => row.reviews.assigned))).toBe(123);
    expect(sum(rows.map((row) => row.reviews.submitted))).toBe(95);
    expect(rows.filter((row) => row.reviews.submitted > 0)).toHaveLength(40);
    expect(rows.filter((row) => range(row) >= WIDE_SPREAD).map((row) => row.reference)).toEqual([
      'NF-CG-0377',
      'NF-CG-0402',
    ]);
  });

  it('gives every reviewer the story’s count assigned and count submitted', () => {
    for (const { name, assigned, submittedBy17March } of reviewers) {
      const mine = reviewedBy(name);
      expect(mine).toHaveLength(assigned);
      expect(
        mine.filter(({ application, position }) => position < application.inBy17March),
      ).toHaveLength(submittedBy17March);
    }
  });

  it('puts Owen Hughes’s inbox in step with the reviews', () => {
    const mine = reviewedBy('Owen Hughes');
    expect(assignments.map((assignment) => assignment.reference).sort()).toEqual(
      mine.map(({ application }) => application.reference).sort(),
    );
    for (const { reference, state } of assignments) {
      const found = mine.find(({ application }) => application.reference === reference);
      const submitted = found ? found.position < found.application.inBy17March : false;
      expect(state === 'Submitted').toBe(submitted);
    }
  });

  it('says what to do next from where each application stands', () => {
    const next = (reference: string) => {
      const row = rows.find((candidate) => candidate.reference === reference);
      return row ? nextStep(row) : '';
    };
    expect(next('NF-CG-0341')).toBe('No further action');
    expect(next('NF-CG-0412')).toBe('Ready for a decision');
    expect(next('NF-CG-0389')).toBe('Waiting for 3 reviews');
    expect(next('NF-CG-0398')).toBe('Waiting for 1 review');
    expect(next('NF-CG-0377')).toBe('Discuss the spread');
    expect(next('NF-CG-0356')).toBe('All reviews in');
  });
});

describe('the scores', () => {
  it('break down into criterion scores that add up to each total', () => {
    for (const row of rows) {
      for (const review of reviewScores(row)) {
        expect(weightedTotal(review.scores)).toBe(review.total);
      }
      const byTotal = (a: number, b: number) => a - b;
      expect(
        reviewScores(row)
          .map((review) => review.total)
          .sort(byTotal),
      ).toEqual([...row.totals].sort(byTotal));
    }
    expect(weightedTotal(breakdown(4.4, 0))).toBe(4.4);
  });

  it('use each reviewer’s total from the story', () => {
    const lantern = rows.find((row) => row.reference === 'NF-CG-0402');
    const reviews = lantern ? reviewScores(lantern) : [];
    expect(reviews.map((review) => review.reviewer)).toEqual([
      'Tom Okafor',
      'Hannah Lewis',
      'Priya Shah',
    ]);
    expect(reviews.map((review) => review.total)).toEqual([1.9, 2.7, 4.1]);
  });
});

describe('the answers', () => {
  it('answer every question each audience sees, by the form’s ids', () => {
    for (const [form, answered] of [
      [staffForm, staffAnswers],
      [reviewerForm, blindAnswers],
    ] as const) {
      for (const field of form.visible) {
        expect(Object.hasOwn(answered, field.id)).toBe(true);
      }
    }
  });

  it('keep staff-only and equality questions out of what reviewers are sent', () => {
    const ids = reviewerForm.visible.map((field) => field.id);
    for (const hidden of [
      'org-name',
      'charity-number',
      'address',
      'contact-name',
      'contact-email',
      'contact-phone',
      'funding-evidence',
      'led-by',
      'beneficiaries',
    ]) {
      expect(ids).not.toContain(hidden);
      expect(Object.hasOwn(blindAnswers, hidden)).toBe(false);
    }
    expect(JSON.stringify(reviewerForm)).not.toMatch(/Organisation name|contact|trustee/i);
  });

  it('keep equality questions out of what staff read one by one', () => {
    const ids = staffForm.visible.map((field) => field.id);
    expect(ids).toContain('org-name');
    expect(ids).toContain('address');
    expect(ids).not.toContain('led-by');
    expect(ids).not.toContain('beneficiaries');
  });

  it('come to the amounts requested', () => {
    expect(sum(budget.map((line) => line.cost)) - otherFunding.amount).toBe(12_500);
    expect(blindRequested).toBe(18_000);
  });
});
