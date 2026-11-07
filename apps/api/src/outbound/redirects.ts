// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The redirect limit (ADR 0010). `fetch` follows redirects above the
// dispatcher, and `node:https` does not follow them at all, so the dispatcher
// and the agent each see every hop as a new request. The ledger links them:
// when a response redirects, it records the target's URL with the depth
// reached, and the request that next arrives for that URL takes the depth
// from it. The fourth redirect response is refused.

import { MAX_REDIRECTS } from './limits.ts';
import { OutboundError } from './errors.ts';

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const EXPIRES_MS = 120_000;
const MAX_PENDING = 1000;

/** A request's identity as a redirect target: no fragment, no empty query. */
const keyOf = (url: URL): string => `${url.protocol}//${url.host}${url.pathname}${url.search}`;

export class RedirectLedger {
  readonly #pending = new Map<string, { depth: number; expires: number }>();

  /** The number of redirects that led to this request, 0 for a first request. */
  enter(url: URL): number {
    const key = keyOf(url);
    const entry = this.#pending.get(key);
    this.#pending.delete(key);
    return entry !== undefined && entry.expires > Date.now() ? entry.depth : 0;
  }

  /** Check a response to a request at `depth`. Throws if it redirects where it may not. */
  follow(url: URL, depth: number, status: number, location: string | string[] | undefined): void {
    if (location === undefined || !REDIRECT_STATUSES.has(status)) return;
    // A repeated Location header is joined by `fetch`, which then follows it unseen.
    if (typeof location !== 'string') throw new OutboundError('redirect_refused');
    if (depth >= MAX_REDIRECTS) throw new OutboundError('too_many_redirects');
    let target: URL;
    try {
      target = new URL(location, url);
    } catch {
      throw new OutboundError('redirect_refused');
    }
    if (target.protocol !== 'https:') throw new OutboundError('scheme_refused');
    if (target.username !== '' || target.password !== '') {
      throw new OutboundError('redirect_refused');
    }
    if (this.#pending.size >= MAX_PENDING) {
      const [oldest] = this.#pending.keys();
      if (oldest !== undefined) this.#pending.delete(oldest);
    }
    this.#pending.set(keyOf(target), { depth: depth + 1, expires: Date.now() + EXPIRES_MS });
  }
}
