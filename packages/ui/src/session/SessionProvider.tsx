// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { TimeoutDialog } from './TimeoutDialog.tsx';
import { hasPermission } from './types.ts';
import type { SessionData, SessionState } from './types.ts';

/** How long before the session ends the warning appears (ADR 0010). */
const WARN_BEFORE_MS = 2 * 60 * 1000;

export interface SessionContextValue {
  state: SessionState;
  /** Read the session again without showing a loading state. Rejects, and keeps the state, when it cannot be read. */
  refresh: () => Promise<void>;
  /** Read the session again from the start, as the first load does. A failure shows as the `failed` state. */
  reload: () => void;
  /** Use a session the API has just returned, after sign-in, a code or a switch of funder. */
  setSession: (session: SessionData) => void;
  /** End the session. Rejects, and keeps the session, when the API cannot be reached. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** The state once the session has been read: a session, or nobody. A session that is gone after one was held has timed out. */
function stateFor(session: SessionData | null, previous: SessionState): SessionState {
  if (session !== null) return { status: 'ready', session };
  return { status: 'signed-out', reason: previous.status === 'ready' ? 'timeout' : null };
}

export interface SessionProviderProps {
  /**
   * Reads the session: the session, or null when nobody is signed in. Throw
   * when it cannot be read. Define it once, outside any component.
   */
  load: () => Promise<SessionData | null>;
  /** Ends the session in the API. Define it once, outside any component. */
  signOut: () => Promise<void>;
  children: ReactNode;
}

/**
 * Holds the session for the app: loads it, and keeps its time. Two minutes
 * before it ends from inactivity (`expiresAt`), a dialog offers to keep the
 * person signed in; when time runs out the state becomes `signed-out` with
 * the reason `timeout`. Pages read the state with useSession().
 */
export function SessionProvider({ load, signOut: endSession, children }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    const session = await load();
    setState((previous) => stateFor(session, previous));
  }, [load]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    refresh().catch(() => {
      setState({ status: 'failed' });
    });
  }, [refresh]);

  useEffect(() => {
    let current = true;
    load().then(
      (session) => {
        if (current) setState((previous) => stateFor(session, previous));
      },
      () => {
        if (current) setState({ status: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [load]);

  const setSession = useCallback((session: SessionData) => {
    setState({ status: 'ready', session });
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    setState({ status: 'signed-out', reason: 'signed-out' });
  }, [endSession]);

  const expire = useCallback(() => {
    setState({ status: 'signed-out', reason: 'timeout' });
  }, []);

  const session = state.status === 'ready' ? state.session : null;
  const expiresAt = session === null ? Number.NaN : Date.parse(session.expiresAt);
  const deadline = Number.isNaN(expiresAt) ? null : expiresAt;
  const now = useClock(deadline, expire);
  const remainingMs = deadline === null ? 0 : deadline - now;
  // A session waiting for MFA cannot be extended, so it is not warned about.
  const warn =
    session !== null &&
    (session.mfa === 'complete' || session.mfa === 'not_required') &&
    remainingMs > 0 &&
    remainingMs <= WARN_BEFORE_MS;

  const value = useMemo(
    () => ({ state, refresh, reload, setSession, signOut }),
    [state, refresh, reload, setSession, signOut],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      <TimeoutDialog open={warn} remainingMs={remainingMs} onStay={refresh} onSignOut={signOut} />
    </SessionContext.Provider>
  );
}

/**
 * The current time, kept fresh for a session that ends at `deadline`: it
 * changes when the warning is due and then every second, and calls `onExpire`
 * at the deadline. A tab that was asleep checks the clock when it wakes.
 */
function useClock(deadline: number | null, onExpire: () => void): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (deadline === null) return undefined;
    const end = deadline;
    let timer: ReturnType<typeof setTimeout>;

    function schedule() {
      const remaining = end - Date.now();
      const wait =
        remaining > WARN_BEFORE_MS ? remaining - WARN_BEFORE_MS : Math.min(remaining, 1000);
      timer = setTimeout(tick, Math.max(wait, 0));
    }

    function tick() {
      const current = Date.now();
      if (current >= end) {
        onExpire();
        return;
      }
      setNow(current);
      schedule();
    }

    function wake() {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      tick();
    }

    schedule();
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [deadline, onExpire]);

  return now;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}

/** True when the signed-in person holds the permission in the active funder. */
export function useCan(permission: string): boolean {
  const { state } = useSession();
  return state.status === 'ready' && hasPermission(state.session, permission);
}
