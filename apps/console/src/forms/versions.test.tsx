// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, draft, ids, ok, published, reads, version } from './fixtures.ts';

setUpConsoleTests();

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const form = `/northfield/rounds/${ids.round}/form`;

describe("a round's form", () => {
  it('lists the versions with their status and date, and links to the draft and the published version', async () => {
    stubApi(reads(draft, published));
    openConsole(form);

    await heading('Application form');
    const table = await screen.findByRole('table', { name: 'Versions of the form' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByRole('rowheader').textContent).toBe('Version 2');
    expect(within(rows[1] as HTMLElement).getByText('Draft')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Published')).toBeTruthy();
    expect(rows[2]?.textContent).toContain('13 October 2026 at 10am by Ada Reed');
    expect(
      within(rows[1] as HTMLElement)
        .getByRole('link', { name: /Edit draft/ })
        .getAttribute('href'),
    ).toBe(`/northfield/rounds/${ids.round}/form/${ids.draft}`);
    expect(
      within(rows[2] as HTMLElement)
        .getByRole('link', { name: /View/ })
        .getAttribute('href'),
    ).toBe(`/northfield/rounds/${ids.round}/form/${ids.published}`);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Autumn 2026' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create draft' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Edit draft' })).toHaveLength(1);
  });

  it('offers to create a draft when every version is published', async () => {
    stubApi(reads(published));
    openConsole(form);

    expect(await screen.findByRole('button', { name: 'Create draft' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit draft' })).toBeNull();
  });

  it('tells a round with no form what to do, with one way to start', async () => {
    stubApi(reads());
    openConsole(form);

    expect(await screen.findByRole('heading', { level: 2, name: 'No form yet' })).toBeTruthy();
    expect(screen.getByText(/Create a draft to build the form applicants fill in/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Create draft' })).toHaveLength(1);
  });

  it('starts a draft and opens it', async () => {
    const user = userEvent.setup();
    const started = version(ids.draft, 1, 'draft', null);
    const sent = stubApi({
      ...reads(),
      [api.createDraft]: { status: 201, body: started },
      [api.version(ids.draft)]: ok(started),
    });
    openConsole(form);

    await user.click(await screen.findByRole('button', { name: 'Create draft' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'No sections yet' })).toBeTruthy();
    expect(sent.map(({ key }) => key)).toContain(api.createDraft);
    expect(window.location.pathname).toBe(`/northfield/rounds/${ids.round}/form/${ids.draft}`);
  });

  it("says why a draft was not started, in the server's words, and keeps the button", async () => {
    const user = userEvent.setup();
    stubApi({
      ...reads(published),
      [api.createDraft]: problem(
        409,
        'This round already has a draft form. Open the draft, or discard it to start again.',
      ),
    });
    openConsole(form);

    await user.click(await screen.findByRole('button', { name: 'Create draft' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(summary.textContent).toContain('This round already has a draft form.');
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeTruthy();
  });

  it('shows why it could not load, and loads again on trying again', async () => {
    const user = userEvent.setup();
    let busy = true;
    stubApi({
      ...reads(draft),
      [api.versions]: () =>
        busy ? problem(503, 'The service is busy. Try again in a minute.') : ok({ versions: [] }),
    });
    openConsole(form);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Application form' })).toBeTruthy();
    busy = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'No form yet' })).toBeTruthy();
  });

  it('tells someone who cannot set up programmes so, without asking for the form', async () => {
    const sent = stubApi({
      'GET /auth/session': ok(consoleSession({ roles: ['reviewer'] })),
    });
    openConsole(form);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot set up programmes' }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual(['GET /auth/session']);
  });
});
