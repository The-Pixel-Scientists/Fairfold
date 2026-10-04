// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where each kind of page sends a visitor, given the state of their session.
// Paths are inside the funder's address, so they carry no slug.

import { isAppPath, useSearch } from '@pixel-scientists/ui';
import type { SearchSchema, SessionState } from '@pixel-scientists/ui';

/**
 * `account` pages are for people who are not signed in (sign in, sign up,
 * reset); `enrol` and `verify` are the two MFA pages; `member` pages are the
 * console itself.
 */
export type PageKind = 'account' | 'enrol' | 'verify' | 'member';

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
  if (next !== null && next !== '/') query.set('next', next);
  if (notice !== null) query.set('notice', notice);
  const text = query.toString();
  return text === '' ? path : `${path}?${text}`;
}

/**
 * The path a page of this kind sends the visitor to, or null when they
 * belong on it. `here` is the page's own path and search, kept as `next`
 * for a member page; the other kinds pass on the `next` they were given.
 */
export function redirectFor(
  kind: PageKind,
  state: SessionState,
  here: string,
  next: string | null,
): string | null {
  const keep = kind === 'member' ? here : next;
  if (state.status === 'signed-out') {
    if (kind === 'account') return null;
    if (kind === 'member' && state.reason === 'signed-out') return '/signed-out';
    return withQuery('/sign-in', keep, state.reason === 'timeout' ? 'timeout' : null);
  }
  if (state.status !== 'ready') return null;

  const { mfa } = state.session;
  if (mfa === 'enrol') return kind === 'enrol' ? null : withQuery('/set-up-authenticator', keep);
  if (mfa === 'verify') return kind === 'verify' ? null : withQuery('/enter-code', keep);
  return kind === 'member' ? null : (next ?? '/');
}
