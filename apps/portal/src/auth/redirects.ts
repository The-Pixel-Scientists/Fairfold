// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where each kind of page sends a visitor, given the state of their session.
// Paths are inside the funder's address, so they carry no slug.

import { isAppPath, useSearch } from '@pixel-scientists/ui';
import type { SearchSchema, SessionState } from '@pixel-scientists/ui';

import { HOME_PATH, SIGNED_OUT_PATH, SIGN_IN_PATH } from '../paths.ts';

/**
 * `account` pages are for people who are not signed in (sign in, sign up,
 * reset). `open` pages are for anyone: the funder's start page, which shows a
 * signed-in applicant their own page instead, and the page not found.
 */
export type PageKind = 'account' | 'open';

/** The sentences the sign-in page can open with, by the word in `?notice=`. */
export const notices = ['timeout', 'account-created', 'password-reset'] as const;

export type Notice = (typeof notices)[number];

export interface PageSearch {
  /** Where to go once signed in. Only ever a path inside the app. */
  next: string | null;
  notice: Notice | null;
}

/** Reads `?next=` and `?notice=`, and drops any value that is not an app path or a known notice. */
const pageSearch: SearchSchema<PageSearch> = {
  safeParse(input) {
    const { next, notice } = input as Record<string, string | string[] | undefined>;
    return {
      success: true,
      data: {
        next: typeof next === 'string' && isAppPath(next) ? next : null,
        notice: notices.find((known) => known === notice) ?? null,
      },
    };
  },
};

export function usePageSearch(): PageSearch {
  const result = useSearch(pageSearch);
  return result.success ? result.data : { next: null, notice: null };
}

/** A path with `?next=` (unless it is the home page) and `?notice=` when there is something to say. */
export function withQuery(path: string, next: string | null, notice: Notice | null = null): string {
  const query = new URLSearchParams();
  if (next !== null && next !== HOME_PATH) query.set('next', next);
  if (notice !== null) query.set('notice', notice);
  const text = query.toString();
  return text === '' ? path : `${path}?${text}`;
}

/**
 * The path a page of this kind sends the visitor to, or null when they
 * belong on it. `here` is the page's own path and search, kept as `next`
 * when a session has ended; `next` is where an account page was asked to go.
 *
 * An open page leaves for the page that explains only when the session ended
 * while the person was on it (`signedInHere`). Someone who arrives there after
 * signing out, such as by the link to the start page, stays.
 */
export function redirectFor(
  kind: PageKind,
  state: SessionState,
  here: string,
  next: string | null,
  signedInHere: boolean,
): string | null {
  if (state.status === 'signed-out') {
    if (kind === 'account' || !signedInHere) return null;
    return state.reason === 'signed-out'
      ? SIGNED_OUT_PATH
      : withQuery(SIGN_IN_PATH, here, 'timeout');
  }
  if (state.status !== 'ready') return null;
  return kind === 'account' ? (next ?? HOME_PATH) : null;
}
