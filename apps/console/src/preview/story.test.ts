// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The figures the previews write out by hand, such as "28 reviews to finish",
// checked against the applications they are counted from.

import { describe, expect, it } from 'vitest';

import { candidates, total } from './decide/decisions-data.ts';
import { areas } from './insight/geographyData.ts';
import { calibration, disagreement, gap, panelMean } from './insight/reviewerData.ts';
import { figuresFor, themes } from './insight/roundData.ts';
import { range, rows } from './review/data.ts';
import { figures, nextToDo, receivedSoFar, reviewersToChase, stages } from './setup/data.ts';
import { applications } from './story.ts';

const eligible = applications.filter((application) => application.ineligible === undefined);
const owed = (name: string) =>
  eligible.filter((application) =>
    application.reviews.some(
      (review, position) => review.reviewer === name && position >= application.inBy17March,
    ),
  ).length;

describe('on 15 February 2027', () => {
  it('has 6 applications in', () => {
    expect(receivedSoFar).toBe(6);
  });
});

describe('on 17 March 2027', () => {
  it('has 28 reviews to finish, most of them Daniel Price’s and Tom Okafor’s', () => {
    const assigned = total(rows.map((row) => row.reviews.assigned));
    const submitted = total(rows.map((row) => row.reviews.submitted));
    expect(assigned - submitted).toBe(28);
    expect(owed('Daniel Price')).toBe(9);
    expect(owed('Tom Okafor')).toBe(7);
  });

  it('has 33 applications with two reviews or more and 22 with all three', () => {
    expect(rows.filter((row) => row.totals.length >= 2)).toHaveLength(33);
    expect(rows.filter((row) => row.totals.length === 3)).toHaveLength(22);
  });

  it('has a median range of 0.4, the 17th of the 33 ranges', () => {
    const ranges = rows
      .filter((row) => row.totals.length >= 2)
      .map(range)
      .sort((a, b) => a - b);
    expect(ranges[16]).toBe(0.4);
  });

  it('counts the round page from the applications', () => {
    expect(figures).toEqual({
      received: 48,
      eligible: 41,
      requested: 612_400,
      assigned: 123,
      submitted: 95,
      shortlisted: 11,
    });
    expect(reviewersToChase).toBe(5);
    expect(stages.map((stage) => stage.count)).toEqual([48, 41, 41, 0]);
    expect(stages.map((stage) => stage.caption)).toContain('eligible, 7 not');
    expect(stages.map((stage) => stage.caption)).toContain(
      '95 of 123 reviews done, 11 shortlisted',
    );
  });

  it('writes what to do next from the same counts', () => {
    expect(nextToDo.map((item) => [item.title, item.detail])).toEqual([
      [
        '28 reviews to finish',
        'Daniel Price has 9 to go and Tom Okafor has 7. Reviews are due on 24 March 2027.',
      ],
      [
        '2 applications have a wide spread of scores',
        'NF-CG-0377 and NF-CG-0402 have reviewers 1.5 points or more apart.',
      ],
      [
        '11 applications are shortlisted',
        'Applications that average 3.5 or more are shortlisted once all three reviews are in.',
      ],
      ['Recommend amounts before the panel meets', 'The decision panel meets on 26 March 2027.'],
    ]);
  });
});

describe('on 26 March 2027', () => {
  it('has 14 accepted for £187,500, 6 waitlisted and 21 declined', () => {
    const withOutcome = (outcome: string) => candidates.filter((item) => item.outcome === outcome);
    const accepted = withOutcome('Accept');
    expect(accepted).toHaveLength(14);
    expect(total(accepted.map((item) => item.amount))).toBe(187_500);
    expect(withOutcome('Waitlist')).toHaveLength(6);
    expect(total(withOutcome('Waitlist').map((item) => item.requested))).toBe(85_900);
    expect(withOutcome('Decline')).toHaveLength(21);
    expect(total(withOutcome('Decline').map((item) => item.requested))).toBe(296_200);
  });

  it('asks £574,900 across the 41 eligible applications and £37,500 across the 7 that are not', () => {
    expect(candidates).toHaveLength(41);
    expect(total(candidates.map((item) => item.requested))).toBe(574_900);
    const ineligible = applications.filter((application) => application.ineligible !== undefined);
    expect(total(ineligible.map((application) => application.requested))).toBe(37_500);
  });

  it('ranks the applications in the order the story lists them', () => {
    expect(candidates.map((item) => item.reference)).toEqual(
      eligible.map((application) => application.reference),
    );
  });
});

describe('on 2 April 2027', () => {
  it('has the funnel and the themes of the round dashboard', () => {
    const all = figuresFor(themes);
    expect(all).toMatchObject({
      started: 71,
      submitted: 48,
      eligible: 41,
      reviewed: 41,
      shortlisted: 22,
      grants: 14,
      requested: 612_400,
      awarded: 187_500,
    });
    expect(all.perDay.slice(-3)).toEqual([8, 9, 12]);
  });

  it('has the two most deprived areas getting 41% of the money', () => {
    const deprived = areas.filter((area) => area.decile <= 2);
    const amount = total(deprived.map((area) => area.amount));
    expect(amount).toBe(76_500);
    expect(Math.round((amount / total(areas.map((area) => area.amount))) * 100)).toBe(41);
  });

  it('has shares of disagreement that are whole numbers of the 41 applications', () => {
    expect(disagreement.map((row) => row.count)).toEqual([10, 7, 5, 3, 2]);
    expect(disagreement.map((row) => row.share)).toEqual([24, 17, 12, 7, 5]);
  });

  it('has one reviewer 0.6 below the panel, whose like-for-like gap is 0.7', () => {
    expect(panelMean).toBe(3.5);
    const below = calibration.filter((reviewer) => gap(reviewer) <= -0.5);
    expect(below.map((reviewer) => [reviewer.name, gap(reviewer), reviewer.assigned])).toEqual([
      ['Tom Okafor', -0.6, 21],
    ]);
    const others = eligible
      .filter((application) => application.reviews.some((r) => r.reviewer === 'Tom Okafor'))
      .flatMap((application) => application.reviews.filter((r) => r.reviewer !== 'Tom Okafor'));
    const othersMean = total(others.map((review) => review.total)) / others.length;
    expect(othersMean.toFixed(1)).toBe('3.6');
    expect((othersMean - (below[0]?.mean ?? 0)).toFixed(1)).toBe('0.7');
  });
});
