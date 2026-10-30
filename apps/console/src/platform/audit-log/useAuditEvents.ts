// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The log's events for a set of filters, a page at a time. The rows read so
// far are kept in memory for each address, so going Back shows them at once
// and the router can restore the scroll position before the fresh page
// replaces them. The copy belongs to one membership and is dropped when the
// page is reloaded.

import { messages } from '@pixel-scientists/domain/platform';
import type { AuditEvent } from '@pixel-scientists/domain/platform/audit-log';
import { asProblem, useSession } from '@pixel-scientists/ui';
import type { Loaded } from '@pixel-scientists/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { loadEvents, loadTimeZone } from './loaders.ts';
import { searchOf } from './query.ts';
import type { AuditFilters } from './query.ts';

export interface AuditRows {
  events: readonly AuditEvent[];
  /** Sent back to read the next page; null on the last one. */
  nextCursor: string | null;
  /** The funder's time zone, or null to use the browser's. */
  zone: string | null;
}

const MAX_KEPT = 10;
const kept = new Map<string, AuditRows>();

function keep(key: string, rows: AuditRows): void {
  kept.delete(key);
  kept.set(key, rows);
  const [oldest] = kept.keys();
  if (kept.size > MAX_KEPT && oldest !== undefined) kept.delete(oldest);
}

const zones = new Map<string, Promise<string | null>>();

/** One read of the time zone for each membership. */
function zoneOf(membership: string): Promise<string | null> {
  const known = zones.get(membership);
  if (known !== undefined) return known;
  const read = loadTimeZone();
  zones.set(membership, read);
  return read;
}

export interface AuditEventsState {
  state: Loaded<AuditRows>;
  /** Reads the first page again. */
  reload: () => void;
  /** Adds the next page to the rows. Gives the words for what went wrong, or null when it worked. */
  loadMore: () => Promise<string | null>;
}

/** Give it the filters that useSearch returned, which stay the same object until the address changes. */
export function useAuditEvents(filters: AuditFilters): AuditEventsState {
  const { state: session } = useSession();
  const membership =
    (session.status === 'ready' ? session.session.activeMembership?.id : undefined) ?? '';
  const key = `${membership}${searchOf(filters)}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: Loaded<AuditRows> } | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([loadEvents(filters), zoneOf(membership)]).then(
      ([page, zone]) => {
        const rows = { events: page.events, nextCursor: page.nextCursor, zone };
        keep(key, rows);
        if (current) setResult({ key, state: { status: 'ready', value: rows } });
      },
      (error: unknown) => {
        const message = asProblem(error)?.detail ?? messages.serviceFailed;
        if (current) setResult({ key, state: { status: 'failed', message } });
      },
    );
    return () => {
      current = false;
    };
  }, [filters, key, membership, attempt]);

  const reload = useCallback(() => {
    kept.delete(key);
    setResult(null);
    setAttempt((count) => count + 1);
  }, [key]);

  const earlier = kept.get(key);
  const state = useMemo<Loaded<AuditRows>>(
    () =>
      result?.key === key
        ? result.state
        : earlier === undefined
          ? { status: 'loading' }
          : { status: 'ready', value: earlier },
    [result, key, earlier],
  );

  const loadMore = useCallback(async () => {
    if (state.status !== 'ready' || state.value.nextCursor === null) return null;
    const { events, nextCursor, zone } = state.value;
    try {
      const page = await loadEvents(filters, nextCursor);
      const rows = { events: [...events, ...page.events], nextCursor: page.nextCursor, zone };
      keep(key, rows);
      setResult((now) =>
        now?.key === key || now === null ? { key, state: { status: 'ready', value: rows } } : now,
      );
      return null;
    } catch (error) {
      return asProblem(error)?.detail ?? messages.serviceFailed;
    }
  }, [state, filters, key]);

  return { state, reload, loadMore };
}
