// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews: the pages around the console, outside the staff shell.

import type { RouteDefinition } from '@pixel-scientists/ui';

import SignedOut from './SignedOut.tsx';

export const signedOutPath = '/signed-out';

/**
 * The page is in the bundle, not loaded on demand: it sits in a different frame
 * from the page before it, so a page that loaded late would not be there for the
 * router to move focus to its heading.
 */
export const accountRoutes: readonly RouteDefinition[] = [
  { path: signedOutPath, title: 'You have signed out', component: SignedOut },
];
