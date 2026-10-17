// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant's route through a grant: the programmes open, a round, who is
// applying, then the application, its eligibility, its sections, the check and
// the confirmation. Each page loads on demand, since the forms are large and
// an applicant is on the sign-in pages first.

import { idSchema } from '@pixel-scientists/domain';
import { sectionIdSchema } from '@pixel-scientists/domain/forms';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';

import {
  APPLICATIONS_PATH,
  APPLICATION_PATH,
  CHECK_PATH,
  ELIGIBILITY_PATH,
  PROGRAMMES_PATH,
  PROGRAMME_PATH,
  SECTION_PATH,
  START_APPLICATION_PATH,
  SUBMITTED_PATH,
} from '../paths.ts';

interface Checks {
  safeParse: (value: unknown) => { success: boolean };
}

/** Only a real id is an address, so a typing mistake or a made-up link never reaches a page. */
function validParams(checks: Record<string, Checks>): SearchSchema<Params> {
  return {
    safeParse: (input) =>
      Object.entries(checks).every(
        ([name, check]) => check.safeParse((input as Params)[name]).success,
      )
        ? { success: true, data: input as Params }
        : { success: false, error: null },
  };
}

const round = validParams({ roundId: idSchema });
const application = validParams({ applicationId: idSchema });
const section = validParams({ applicationId: idSchema, sectionId: sectionIdSchema });

export const applyRoutes: readonly RouteDefinition[] = [
  {
    path: PROGRAMMES_PATH,
    title: 'Programmes you can apply to',
    load: () => import('./ProgrammesPage.tsx'),
  },
  {
    path: PROGRAMME_PATH,
    title: 'Programme',
    params: round,
    load: () => import('./RoundPage.tsx'),
  },
  {
    path: START_APPLICATION_PATH,
    title: 'Who is applying?',
    params: round,
    load: () => import('./StartApplicationPage.tsx'),
  },
  {
    path: APPLICATIONS_PATH,
    title: 'Your applications',
    load: () => import('./ApplicationsPage.tsx'),
  },
  {
    path: APPLICATION_PATH,
    title: 'Your application',
    params: application,
    load: () => import('./ApplicationPage.tsx'),
  },
  {
    path: ELIGIBILITY_PATH,
    title: 'Check you can apply',
    params: application,
    load: () => import('./EligibilityPage.tsx'),
  },
  {
    path: SECTION_PATH,
    title: 'Your application',
    params: section,
    load: () => import('./SectionPage.tsx'),
  },
  {
    path: CHECK_PATH,
    title: 'Check your answers',
    params: application,
    load: () => import('./CheckPage.tsx'),
  },
  {
    path: SUBMITTED_PATH,
    title: 'Application submitted',
    params: application,
    load: () => import('./SubmittedPage.tsx'),
  },
];
