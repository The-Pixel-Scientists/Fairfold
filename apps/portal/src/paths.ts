// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where each portal page lives. Pages link to each other by these, never by a
 * typed string. The first two are outside any funder's address; the rest are
 * inside it, so each one is written without the `/<slug>` in front.
 */
export const HOME_PATH = '/';
export const HOW_APPLYING_WORKS_PATH = '/how-applying-works';

export const SIGN_UP_PATH = '/sign-up';
export const CHECK_EMAIL_PATH = '/sign-up/check-email';
export const COMPLETE_SIGN_UP_PATH = '/sign-up/complete';
export const SIGN_IN_PATH = '/sign-in';
export const FORGOT_PASSWORD_PATH = '/forgot-password';
export const PASSWORD_RESET_SENT_PATH = '/forgot-password/sent';
export const RESET_PASSWORD_PATH = '/reset-password';
export const SIGNED_OUT_PATH = '/signed-out';

export const PROFILE_PATH = '/profile';
export const ORGANISATIONS_PATH = '/organisations';
export const ADD_ORGANISATION_PATH = '/organisations/new';
export const ORGANISATION_PATH = '/organisations/:organisationId';
export const FUTURE_FUNDING_PATH = '/future-funding';

export const PROGRAMMES_PATH = '/programmes';
export const PROGRAMME_PATH = '/programmes/:roundId';
export const START_APPLICATION_PATH = '/programmes/:roundId/start';
export const APPLICATIONS_PATH = '/applications';
export const APPLICATION_PATH = '/applications/:applicationId';
export const ELIGIBILITY_PATH = '/applications/:applicationId/eligibility';
export const SECTION_PATH = '/applications/:applicationId/sections/:sectionId';
export const CHECK_PATH = '/applications/:applicationId/check';
export const SUBMITTED_PATH = '/applications/:applicationId/submitted';

/** The path of one organisation's page, from its id. */
export function organisationPath(organisationId: string): string {
  return `${ORGANISATIONS_PATH}/${encodeURIComponent(organisationId)}`;
}

const segment = encodeURIComponent;

/** The path of one programme's round, from the round's id. */
export function programmePath(roundId: string): string {
  return `${PROGRAMMES_PATH}/${segment(roundId)}`;
}

export function startApplicationPath(roundId: string): string {
  return `${programmePath(roundId)}/start`;
}

/** The path of one application, from its id. The pages below it are written from this. */
export function applicationPath(applicationId: string): string {
  return `${APPLICATIONS_PATH}/${segment(applicationId)}`;
}

export function eligibilityPath(applicationId: string): string {
  return `${applicationPath(applicationId)}/eligibility`;
}

export function sectionPath(applicationId: string, sectionId: string): string {
  return `${applicationPath(applicationId)}/sections/${segment(sectionId)}`;
}

export function checkPath(applicationId: string): string {
  return `${applicationPath(applicationId)}/check`;
}

export function submittedPath(applicationId: string): string {
  return `${applicationPath(applicationId)}/submitted`;
}
