// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { eastmere, consoleSession, northfield, problem, stubApi } from '../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { openFunder } from './openFunder.ts';
import { navigationItems, visibleItems } from './navigation.ts';

vi.mock('./openFunder.ts', () => ({ openFunder: vi.fn() }));

setUpConsoleTests();

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const session = (body: unknown) => ({ 'GET /auth/session': { status: 200, body } });
const SWITCH = 'POST /auth/switch-tenant';

describe('visibleItems', () => {
  const items = [
    { to: '/', label: 'Programmes', permission: 'grants.programmes.manage' },
    { to: '/team', label: 'Team', permission: 'platform.members.manage' },
    { to: '/reviews', label: 'Reviews', permission: 'grants.reviews.score' },
  ] as const;

  it('keeps only the items whose permission the session holds', () => {
    expect(
      visibleItems({ permissions: ['grants.reviews.score', 'platform.members.manage'] }, items).map(
        ({ label }) => label,
      ),
    ).toEqual(['Team', 'Reviews']);
    expect(visibleItems({ permissions: [] }, items)).toEqual([]);
  });

  it('gives every console page the permission that opens it', () => {
    for (const item of navigationItems) expect(item.permission).toMatch(/^[a-z]+\.[a-z]+\.[a-z]+$/);
  });
});

describe('the console shell', () => {
  it('shows the funder, who is signed in, and the pages their permissions open', async () => {
    stubApi(session(consoleSession()));
    openConsole('/northfield/');

    await heading('Programmes');

    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('Northfield Foundation')).toBeTruthy();
    expect(within(banner).getByText('ada@example.org')).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: 'Main' });
    const link = within(navigation).getByRole('link', { name: 'Programmes' });
    expect(link.getAttribute('href')).toBe('/northfield/');
    expect(link.getAttribute('aria-current')).toBe('page');
    await expectTitle('Programmes – Fairfold Grants console');
  });

  it('leaves out pages the person has no permission for, and the navigation when none is left', async () => {
    stubApi(session(consoleSession({ roles: ['reviewer'] })));
    openConsole('/northfield/');

    await heading('Programmes');

    expect(screen.queryByRole('link', { name: 'Programmes' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('has no switch for a person with one funder', async () => {
    stubApi(session(consoleSession()));
    openConsole('/northfield/');
    await heading('Programmes');

    expect(screen.queryByRole('button', { name: 'Switch funder' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('switching funder', () => {
  const both = consoleSession({ memberships: [northfield, eastmere] });

  it('lists the other funders, from the keyboard, and not the current one', async () => {
    const user = userEvent.setup();
    stubApi(session(both));
    openConsole('/northfield/');
    await heading('Programmes');

    screen.getByRole('button', { name: 'Switch funder' }).focus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Switch funder' });
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Switch to Eastmere Trust' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Switch funder' }));
  });

  it('asks the API to switch, then opens the new funder address', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...session(both),
      [SWITCH]: {
        status: 200,
        body: consoleSession({ active: eastmere, memberships: [northfield, eastmere] }),
      },
    });
    openConsole('/northfield/');
    await heading('Programmes');

    await user.click(screen.getByRole('button', { name: 'Switch funder' }));
    await user.click(await screen.findByRole('button', { name: 'Switch to Eastmere Trust' }));

    await waitFor(() => {
      expect(openFunder).toHaveBeenCalledWith('eastmere');
    });
    expect(sent.find(({ key }) => key === SWITCH)?.body).toEqual({ membershipId: eastmere.id });
  });

  it('says what went wrong, and stays, when the switch is refused', async () => {
    const user = userEvent.setup();
    stubApi({ ...session(both), [SWITCH]: problem(403, 'You cannot switch to this funder.') });
    vi.mocked(openFunder).mockClear();
    openConsole('/northfield/');
    await heading('Programmes');

    await user.click(screen.getByRole('button', { name: 'Switch funder' }));
    await user.click(await screen.findByRole('button', { name: 'Switch to Eastmere Trust' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('You cannot switch to this funder.');
    expect(openFunder).not.toHaveBeenCalled();
  });
});

describe('a signed-in person who is not working for this funder', () => {
  it('is told they have no access, and can switch to a funder they belong to, or sign out', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...session(consoleSession({ active: null, memberships: [eastmere] })),
      'POST /auth/sign-out': { status: 204 },
    });
    openConsole('/northfield/');

    await heading('You do not have access to northfield');

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to Eastmere Trust' })).toBeTruthy();
    await expectTitle('Programmes – Fairfold Grants console');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await heading('You have signed out');
    expect(sent.map(({ key }) => key)).toContain('POST /auth/sign-out');
  });

  it('says so when they have no funder at all', async () => {
    stubApi(session(consoleSession({ active: null, memberships: [] })));
    openConsole('/northfield/');

    await heading('You do not have access to northfield');

    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull();
    expect(screen.getByText(/Ask its administrator to invite you/)).toBeTruthy();
  });

  it('offers to switch when they belong to this funder but are working for another', async () => {
    stubApi(session(consoleSession({ active: eastmere, memberships: [northfield, eastmere] })));
    openConsole('/northfield/');

    await heading('Switch to Northfield Foundation');

    expect(screen.getByRole('button', { name: 'Switch to Northfield Foundation' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /do not have access/ })).toBeNull();
  });
});

describe('addresses outside a funder', () => {
  it('tells someone at the root to use their funder link', async () => {
    openConsole('/');

    expect(await heading("Use your funder's link")).toBeTruthy();
    await expectTitle("Use your funder's link – Fairfold Grants console");
    expect(screen.getByText(/open the link your funder gave you/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('says a page is not found for something that is not a funder slug', async () => {
    openConsole('/Not_A_Funder/sign-in');

    expect(await heading('Page not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe(
      '/',
    );
  });
});
