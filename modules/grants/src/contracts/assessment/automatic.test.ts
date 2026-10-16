// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { assignReviewersAutomatically } from './automatic.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('automatic assignment', () => {
  it('keeps every route rule, for members who assign reviews', () => {
    expect(checkRoute(assignReviewersAutomatically)).toEqual([]);
    expect(assignReviewersAutomatically).toMatchObject({
      audience: 'console',
      module: 'grants',
      permission: 'grants.reviews.assign',
      scope: 'tenant',
      method: 'POST',
      path: '/console/stages/:stageId/assignments/automatic',
    });
  });

  it('gives each chosen submission 1 to 5 reviewers', () => {
    const { body } = assignReviewersAutomatically;
    for (const count of [1, 5]) {
      expect(body.safeParse({ submissionIds: [ID], reviewersPerSubmission: count }).success).toBe(
        true,
      );
    }
    for (const bad of [
      { submissionIds: [ID], reviewersPerSubmission: 0 },
      { submissionIds: [ID], reviewersPerSubmission: 6 },
      { submissionIds: [ID], reviewersPerSubmission: 1.5 },
      { submissionIds: [], reviewersPerSubmission: 2 },
      { submissionIds: [ID, ID], reviewersPerSubmission: 2 },
      { reviewersPerSubmission: 2 },
      { submissionIds: [ID], reviewersPerSubmission: 2, membershipIds: [ID] },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
