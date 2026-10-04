// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider, useCan, useSession } from './SessionProvider.tsx';
import type { SessionProviderProps } from './SessionProvider.tsx';
import type { SessionData } from './types.ts';

const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T10:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A complete session that ends `minutes` from now. */
function sessionEndingIn(minutes: number, overrides: Partial<SessionData> = {}): SessionData {
  return {
    mfa: 'complete',
    expiresAt: new Date(Date.now() + minutes * MINUTE).toISOString(),
    user: { email: 'ada@example.org' },
    permissions: ['grants.programmes.manage'],
    activeMembership: { id: 'm1', tenant: { slug: 'northfield', name: 'Northfield Foundation' } },
    memberships: [{ id: 'm1', tenant: { slug: 'northfield', name: 'Northfield Foundation' } }],
    ...overrides,
  };
}

function Probe() {
  const { state, setSession, signOut, reload } = useSession();
  const canManage = useCan('grants.programmes.manage');
  const canExport = useCan('platform.warehouse.export');
  return (
    <div>
      <p data-testid="state">
        {state.status}
        {state.status === 'signed-out' && `:${String(state.reason)}`}
      </p>
      <p data-testid="can">{`${String(canManage)} ${String(canExport)}`}</p>
      {state.status === 'ready' && <p data-testid="email">{state.session.user.email}</p>}
      <button
        type="button"
        onClick={() => {
          setSession(sessionEndingIn(30, { user: { email: 'grace@example.org' } }));
        }}
      >
        Use new session
      </button>
      <button type="button" onClick={() => void signOut().catch(() => undefined)}>
        End session
      </button>
      <button type="button" onClick={reload}>
        Read again
      </button>
    </div>
  );
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderSession(props: Partial<SessionProviderProps> = {}) {
  const load = props.load ?? vi.fn(() => Promise.resolve<SessionData | null>(sessionEndingIn(30)));
  const signOut = props.signOut ?? vi.fn(() => Promise.resolve());
  render(
    <SessionProvider load={load} signOut={signOut}>
      <Probe />
    </SessionProvider>,
  );
  await flush();
  return { load, signOut };
}

const state = () => screen.getByTestId('state').textContent;

describe('SessionProvider: loading', () => {
  it('starts loading, then holds the session', async () => {
    let finish: (session: SessionData | null) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<SessionData | null>((resolve) => {
          finish = resolve;
        }),
    );
    await renderSession({ load });
    expect(state()).toBe('loading');

    finish(sessionEndingIn(30));
    await flush();

    expect(state()).toBe('ready');
    expect(screen.getByTestId('email').textContent).toBe('ada@example.org');
  });

  it('says nobody is signed in when there is no session', async () => {
    await renderSession({ load: () => Promise.resolve(null) });
    expect(state()).toBe('signed-out:null');
  });

  it('says it could not read the session, and tries again from the start on reload', async () => {
    const load = vi
      .fn<() => Promise<SessionData | null>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(sessionEndingIn(30));
    await renderSession({ load });
    expect(state()).toBe('failed');

    await act(async () => {
      screen.getByRole('button', { name: 'Read again' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(state()).toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('uses a session the app gives it, after sign-in for example', async () => {
    await renderSession({ load: () => Promise.resolve(null) });

    await act(async () => {
      screen.getByRole('button', { name: 'Use new session' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(state()).toBe('ready');
    expect(screen.getByTestId('email').textContent).toBe('grace@example.org');
  });
});

describe('useCan', () => {
  it('is true only for a permission the active membership gives', async () => {
    await renderSession();
    expect(screen.getByTestId('can').textContent).toBe('true false');
  });

  it('is false until a session is ready', async () => {
    await renderSession({ load: () => Promise.resolve(null) });
    expect(screen.getByTestId('can').textContent).toBe('false false');
  });

  it('says so when used outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useSession must be used inside a SessionProvider.');
  });
});

describe('SessionProvider: signing out', () => {
  it('ends the session in the API, then says why nobody is signed in', async () => {
    const { signOut } = await renderSession();

    await act(async () => {
      screen.getByRole('button', { name: 'End session' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(signOut).toHaveBeenCalledOnce();
    expect(state()).toBe('signed-out:signed-out');
  });

  it('keeps the session when the API cannot be reached', async () => {
    await renderSession({ signOut: () => Promise.reject(new Error('offline')) });

    await act(async () => {
      screen.getByRole('button', { name: 'End session' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(state()).toBe('ready');
  });
});

describe('SessionProvider: the idle warning', () => {
  it('stays quiet until two minutes before the session ends', async () => {
    await renderSession({ load: () => Promise.resolve(sessionEndingIn(10)) });

    await flush(8 * MINUTE - 1000);
    expect(screen.queryByRole('dialog')).toBeNull();

    await flush(1000);
    expect(screen.getByRole('dialog', { name: 'You will be signed out soon' })).toBeTruthy();
  });

  it('puts focus on "Stay signed in" and says how long is left, politely and not every second', async () => {
    await renderSession({ load: () => Promise.resolve(sessionEndingIn(2)) });
    await flush(10);

    const dialog = screen.getByRole('dialog', { name: 'You will be signed out soon' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stay signed in' }));
    const status = dialog.querySelector('[role="status"]');
    expect(status?.textContent).toBe('You will be signed out in 2 minutes.');

    await flush(5000);
    expect(status?.textContent).toBe('You will be signed out in 2 minutes.');
    await flush(30_000);
    expect(status?.textContent).toBe('You will be signed out in 1 minute 30 seconds.');
    // The countdown on screen moves every second, and is hidden from screen readers.
    const countdown = dialog.querySelector('[aria-hidden="true"]');
    expect(countdown?.textContent).toBe('1:25');
    await flush(1000);
    expect(countdown?.textContent).toBe('1:24');
  });

  it('reads the session again on "Stay signed in", and closes', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const load = vi
      .fn<() => Promise<SessionData | null>>()
      .mockResolvedValueOnce(sessionEndingIn(5))
      .mockImplementation(() => Promise.resolve(sessionEndingIn(30)));
    await renderSession({ load });
    await flush(3 * MINUTE + 1000);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await flush(10);

    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state()).toBe('ready');
    // Focus goes back to where it was before the warning, once the dialog has gone.
    await flush(10);
    expect(document.activeElement).toBe(opener);
    // And the next warning is two minutes before the new end.
    await flush(27 * MINUTE);
    expect(screen.queryByRole('dialog')).toBeNull();
    await flush(MINUTE);
    expect(screen.getByRole('dialog')).toBeTruthy();
    opener.remove();
  });

  it('counts Escape as staying signed in', async () => {
    const load = vi.fn(() => Promise.resolve<SessionData | null>(sessionEndingIn(2)));
    await renderSession({ load });
    await flush(10);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await flush(10);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says so, and stays open, when the session cannot be read', async () => {
    const load = vi
      .fn<() => Promise<SessionData | null>>()
      .mockResolvedValueOnce(sessionEndingIn(2))
      .mockRejectedValue(new Error('offline'));
    await renderSession({ load });
    await flush(10);

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await flush(10);

    expect(screen.getByRole('alert').textContent).toBe(
      'We could not reach the service. Try again, or sign out.',
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('signs out from the dialog', async () => {
    const { signOut } = await renderSession({ load: () => Promise.resolve(sessionEndingIn(2)) });
    await flush(10);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await flush(10);

    expect(signOut).toHaveBeenCalledOnce();
    expect(state()).toBe('signed-out:signed-out');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('signs the person out, saying why, when time runs out', async () => {
    await renderSession({ load: () => Promise.resolve(sessionEndingIn(3)) });

    await flush(3 * MINUTE);

    expect(state()).toBe('signed-out:timeout');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('checks the clock when a sleeping tab wakes', async () => {
    await renderSession({ load: () => Promise.resolve(sessionEndingIn(10)) });

    // The timers did not run while the machine slept: the clock moved on without them.
    vi.setSystemTime(Date.now() + 9 * MINUTE);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog')).toBeTruthy();

    vi.setSystemTime(Date.now() + 2 * MINUTE);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state()).toBe('signed-out:timeout');
  });

  it('does not warn a session that is waiting for MFA, but still ends it', async () => {
    await renderSession({
      load: () =>
        Promise.resolve(
          sessionEndingIn(3, {
            mfa: 'verify',
            permissions: [],
            activeMembership: null,
            memberships: [],
          }),
        ),
    });

    await flush(90_000);
    expect(screen.queryByRole('dialog')).toBeNull();

    await flush(90_000);
    expect(state()).toBe('signed-out:timeout');
  });

  it('says the session ended when reading it again finds nobody', async () => {
    const load = vi
      .fn<() => Promise<SessionData | null>>()
      .mockResolvedValueOnce(sessionEndingIn(2))
      .mockResolvedValue(null);
    await renderSession({ load });
    await flush(10);

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await flush(10);

    expect(state()).toBe('signed-out:timeout');
  });
});
