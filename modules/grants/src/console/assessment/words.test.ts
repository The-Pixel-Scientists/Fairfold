// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  applicationName,
  countOf,
  formatScore,
  isWide,
  nameOf,
  reviewStateOf,
  shortId,
} from './words.ts';

describe('assessment words', () => {
  it('counts in the singular and the plural', () => {
    expect(countOf(1, 'reviewer')).toBe('1 reviewer');
    expect(countOf(3, 'reviewer')).toBe('3 reviewers');
    expect(countOf(1, 'criterion', 'criteria')).toBe('1 criterion');
    expect(countOf(2, 'criterion', 'criteria')).toBe('2 criteria');
  });

  it('names a member, or a member with no name on record', () => {
    expect(nameOf('Ada Reed')).toBe('Ada Reed');
    expect(nameOf(null)).toBe('Unnamed member');
  });

  it('knows an application by a short form of its id, and nothing else', () => {
    const id = '3f2a9c1b-5d4e-4a6b-8c7d-9e0f1a2b3c4d';

    expect(shortId(id)).toBe('3F2A9C1B');
    expect(applicationName(id)).toBe('Application 3F2A9C1B');
  });

  it('says where a review stands from its status and how many criteria are scored', () => {
    const progress = (scored: number) => ({ scored, total: 3 });

    expect(reviewStateOf({ status: 'assigned', progress: progress(0) })).toBe('not started');
    expect(reviewStateOf({ status: 'assigned', progress: progress(2) })).toBe('in progress');
    expect(reviewStateOf({ status: 'submitted', progress: progress(3) })).toBe('submitted');
  });

  it('writes scores with one or two decimal places', () => {
    expect(formatScore(4)).toBe('4.0');
    expect(formatScore(3.625)).toBe('3.63');
    expect(formatScore(2.4)).toBe('2.4');
  });

  it('flags a spread of 1.5 or more, and only between two reviews or more', () => {
    expect(isWide({ submitted: 2, range: 1.5 })).toBe(true);
    expect(isWide({ submitted: 3, range: 1.49 })).toBe(false);
    expect(isWide({ submitted: 1, range: 2 })).toBe(false);
    expect(isWide({ submitted: 0, range: null })).toBe(false);
  });
});
