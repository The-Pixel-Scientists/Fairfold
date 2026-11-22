// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where each page lives, inside the funder's address. A form anyone can
// answer and a form for people who sign in have addresses of their own, so
// the public page never reads a session and never tells the two apart.

export const PUBLIC_FORM_PATH = '/forms/:formId';
export const SIGNED_IN_FORM_PATH = '/your-forms/:formId';
export const RESPONSES_PATH = '/form-responses';
export const RESPONSE_PATH = '/form-responses/:responseId';

export function responsePath(responseId: string): string {
  return `${RESPONSES_PATH}/${encodeURIComponent(responseId)}`;
}
