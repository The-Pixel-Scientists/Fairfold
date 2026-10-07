// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews: Triage and assessment: submissions, reviews and the spread of scores.

import type { RouteDefinition } from '@pixel-scientists/ui';

/** Where every other submission and review leads. Its routes go after the pages built in full. */
const standIn = () => import('./StandIn.tsx');

export const reviewRoutes: readonly RouteDefinition[] = [
  { path: '/submissions', title: 'Submissions', load: () => import('./Submissions.tsx') },
  {
    path: '/submissions/NF-CG-0412',
    title: 'Riverside Lunch Club',
    load: () => import('./SubmissionDetail.tsx'),
  },
  {
    path: '/submissions/NF-CG-0412/due-diligence',
    title: 'Riverside Lunch Club: due diligence',
    load: () => import('./SubmissionDetail.tsx'),
  },
  { path: '/submissions/:reference', title: 'Another submission', load: standIn },
  { path: '/reviews', title: 'My reviews', load: () => import('./MyReviews.tsx') },
  {
    path: '/reviews/NF-CG-0398',
    title: 'Friday Night Project',
    load: () => import('./ScoringWorkspace.tsx'),
  },
  { path: '/reviews/spread', title: 'Score spread', load: () => import('./Spread.tsx') },
  { path: '/reviews/:reference', title: 'Another review', load: standIn },
];
