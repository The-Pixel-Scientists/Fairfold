// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's staff screens: the routes the console adds under a
// funder's address, and the pages they put in its navigation. Programme
// set-up, the form builder, submissions, assessment and decisions are here,
// and the 360Giving file for the console's Data page; later grants screens
// extend both lists.

import { idSchema } from '@pixel-scientists/domain';
import type { Permission } from '@pixel-scientists/domain/platform';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';
import { lazy } from 'react';

import { REVIEWS_PATH } from './assessment/paths.ts';
import { NEW_PROGRAMME_PATH, PROGRAMMES_PATH } from './programme/paths.ts';
import { SUBMISSIONS_PATH } from './submissions/paths.ts';

/** Only real ids are the addresses of programmes, rounds and stages, so `/programmes/new` and typing mistakes never reach them. */
const ids: SearchSchema<Params> = {
  safeParse: (input) =>
    Object.values(input as Params).every((value) => idSchema.safeParse(value).success)
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

/** Pages for someone who can set up programmes or read submissions. Each page says so itself when the person cannot. */
export const grantsRoutes: readonly RouteDefinition[] = [
  {
    path: PROGRAMMES_PATH,
    title: 'Programmes',
    load: () => import('./programme/ProgrammesPage.tsx'),
  },
  {
    path: NEW_PROGRAMME_PATH,
    title: 'New programme',
    load: () => import('./programme/NewProgrammePage.tsx'),
  },
  {
    path: '/programmes/:programmeId',
    title: 'Programme',
    params: ids,
    load: () => import('./programme/ProgrammePage.tsx'),
  },
  {
    path: '/programmes/:programmeId/edit',
    title: 'Edit programme',
    params: ids,
    load: () => import('./programme/EditProgrammePage.tsx'),
  },
  {
    path: '/programmes/:programmeId/emails',
    title: 'Outcome emails',
    params: ids,
    load: () => import('./programme/EmailsPage.tsx'),
  },
  {
    path: '/programmes/:programmeId/rounds/new',
    title: 'New round',
    params: ids,
    load: () => import('./programme/NewRoundPage.tsx'),
  },
  {
    path: '/rounds/:roundId',
    title: 'Round',
    params: ids,
    load: () => import('./programme/RoundPage.tsx'),
  },
  {
    path: '/rounds/:roundId/edit',
    title: 'Edit round',
    params: ids,
    load: () => import('./programme/EditRoundPage.tsx'),
  },
  {
    path: '/rounds/:roundId/stages',
    title: 'Stages',
    params: ids,
    load: () => import('./programme/StagesPage.tsx'),
  },
  {
    path: '/rounds/:roundId/stages/:stageId/rubric',
    title: 'Rubric',
    params: ids,
    load: () => import('./programme/RubricPage.tsx'),
  },
  {
    path: '/rounds/:roundId/form',
    title: 'Application form',
    params: ids,
    load: () => import('./forms/FormPage.tsx'),
  },
  {
    path: '/rounds/:roundId/form/:formVersionId',
    title: 'Form version',
    params: ids,
    load: () => import('./forms/FormEditorPage.tsx'),
  },
  {
    path: SUBMISSIONS_PATH,
    title: 'Submissions',
    load: () => import('./submissions/SubmissionsPage.tsx'),
  },
  {
    path: '/submissions/:submissionId',
    title: 'Submission',
    params: ids,
    load: () => import('./submissions/SubmissionPage.tsx'),
  },
  {
    path: '/rounds/:roundId/reviewers',
    title: 'Reviewers',
    params: ids,
    load: () => import('./assessment/ReviewersPage.tsx'),
  },
  {
    path: '/rounds/:roundId/score-spread',
    title: 'Score spread',
    params: ids,
    load: () => import('./assessment/SpreadPage.tsx'),
  },
  {
    path: '/rounds/:roundId/decisions',
    title: 'Decisions',
    params: ids,
    load: () => import('./decisions/DecisionsPage.tsx'),
  },
  {
    path: '/rounds/:roundId/decisions/release',
    title: 'Release decisions',
    params: ids,
    load: () => import('./decisions/ReleasePage.tsx'),
  },
  {
    path: REVIEWS_PATH,
    title: 'My reviews',
    load: () => import('./assessment/MyReviewsPage.tsx'),
  },
  {
    path: '/reviews/:assignmentId',
    title: 'Review',
    params: ids,
    load: () => import('./assessment/ReviewPage.tsx'),
  },
];

/** What the console's navigation lists for grants, each shown only to a session that holds its permission. */
export const grantsNavigation = [
  { to: PROGRAMMES_PATH, label: 'Programmes', permission: 'grants.programmes.manage' },
  { to: SUBMISSIONS_PATH, label: 'Submissions', permission: 'grants.applications.read' },
  { to: REVIEWS_PATH, label: 'My reviews', permission: 'grants.reviews.score' },
] as const satisfies readonly { to: string; label: string; permission: Permission }[];

/** The 360Giving part of the Data page, for a member with `grants.data.export`. Its code loads when the page shows it. */
export const ThreeSixtyGivingSection = lazy(() => import('./export/ThreeSixtyGivingSection.tsx'));
