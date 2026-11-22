// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's applicant screens (ADR 0016): the pages for people who
// sign in, and the page anyone can open. The app shows them under the
// funder's address and gives them a host (host.tsx). Each page loads when its
// address is first opened.

export { FormsHostProvider, useFormsHost, useMemoryDraft } from './host.tsx';
export type { FormsCall, FormsCallOptions, FormsHost, KeptDraft } from './host.tsx';
export { PUBLIC_FORM_PATH, RESPONSES_PATH, RESPONSE_PATH, SIGNED_IN_FORM_PATH } from './paths.ts';

export const loadPublicForm = () => import('./PublicFormPage.tsx');
export const loadSignedInForm = () => import('./SignedInFormPage.tsx');
export const loadMyResponses = () => import('./MyResponsesPage.tsx');
export const loadMyResponse = () => import('./MyResponsePage.tsx');
