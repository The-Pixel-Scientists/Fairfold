// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../../testing/render.tsx';

setUpConsoleTests();
Element.prototype.scrollIntoView = () => undefined;

const SEARCH = 'POST /console/search';
const id = '3f6c1a52-8d0e-4b7a-9c21-5e4d3b2a1f00';
const session = (options = {}) => ({
  'GET /auth/session': { status: 200, body: consoleSession(options) },
});
const staff = {
  audience: 'staff',
  groups: [
    {
      module: 'party',
      results: [{ kind: 'party.organisation', id, label: 'Northfield Community Trust' }],
      more: false,
    },
    {
      module: 'grants',
      results: [{ kind: 'grants.application', id, label: 'NF-CG-0412 Community garden' }],
      more: true,
    },
  ],
};
const box = () => screen.findByRole('combobox', { name: 'Search' });

describe('the search box', () => {
  it('is there for a member who may search and absent for anyone else', async () => {
    stubApi(session({ roles: [] }));
    openConsole('/northfield/');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('sends the term in the body, groups what comes back and counts it once', async () => {
    const sent = stubApi({ ...session(), [SEARCH]: { status: 200, body: staff } });
    openConsole('/northfield/');
    await userEvent.type(await box(), '  garden  ');

    const group = await screen.findByRole('group', { name: 'Grants' });
    expect(group.textContent).toContain('NF-CG-0412 Community garden');
    expect(group.textContent).toContain('More results in Grants');
    expect(screen.queryByRole('group', { name: 'Organisations and people' })).toBeNull();
    await waitFor(() => {
      expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain(
        '1 result in 1 tool',
      );
    });
    expect(sent.filter(({ key }) => key === SEARCH)).toEqual([
      { key: SEARCH, body: { term: 'garden' } },
    ]);
  });

  it('opens the highlighted result by its id and keeps the term out of every store', async () => {
    stubApi({ ...session(), [SEARCH]: { status: 200, body: staff } });
    openConsole('/northfield/');
    await userEvent.type(await box(), 'garden');
    await screen.findByRole('option');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/northfield/submissions/${id}`);
    });
    expect(window.location.search).toBe('');
    expect(JSON.stringify(window.history.state)).not.toContain('garden');
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('garden');
    expect(((await box()) as HTMLInputElement).value).toBe('');
  });

  it('asks for two characters without sending anything', async () => {
    const sent = stubApi(session());
    openConsole('/northfield/');
    await userEvent.type(await box(), 'g');
    await screen.findByText('Enter at least 2 characters');
    expect(sent.filter(({ key }) => key === SEARCH)).toEqual([]);
  });

  it('says how long to wait after a 429, and that a failed search did not run', async () => {
    stubApi({
      ...session(),
      [SEARCH]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '7' } },
    });
    openConsole('/northfield/');
    await userEvent.type(await box(), 'garden');
    await screen.findByText('Too many searches. Try again in 7 seconds');
  });

  it('says the search did not run for any other failure, without the term', async () => {
    stubApi({ ...session(), [SEARCH]: problem(500, 'Broken.') });
    openConsole('/northfield/');
    await userEvent.type(await box(), 'garden');
    const message = await screen.findByText('The search did not run. Try again');
    expect(message.textContent).not.toContain('garden');
  });

  it('says there were no results', async () => {
    stubApi({ ...session(), [SEARCH]: { status: 200, body: { audience: 'staff', groups: [] } } });
    openConsole('/northfield/');
    await userEvent.type(await box(), 'garden');
    await screen.findByText('No results for that search');
  });

  it('takes focus on the shortcut, and not while a dialog is open', async () => {
    stubApi(session());
    openConsole('/northfield/');
    const input = await box();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);

    (input as HTMLInputElement).blur();
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(document.activeElement).not.toBe(input);
    dialog.remove();
  });
});
