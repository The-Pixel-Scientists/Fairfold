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
