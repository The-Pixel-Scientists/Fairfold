// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { titleSuffix } from '../product.ts';
import { problem, stubApi } from '../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, heading, manager, ok, programme, reads } from './fixtures.ts';

setUpConsoleTests();

const title = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' });
const summary = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Summary' });
const description = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description (optional)' });

describe('creating a programme', () => {
  it('asks for a title, summary, description and status, starting as a draft', async () => {
    stubApi({ ...manager() });
    openConsole('/northfield/programmes/new');

    await heading('New programme');

    await expectTitle(`New programme – ${titleSuffix}`);
    expect(title().value).toBe('');
    expect(
      screen.getByText('Applicants see this name, for example Community Spaces Fund.'),
    ).toBeTruthy();
    const status = screen.getByRole('group', { name: 'Status' });
    expect(within(status).getByRole<HTMLInputElement>('radio', { name: 'Draft' }).checked).toBe(
      true,
    );
    expect(
      within(status).getByText('Applicants cannot see it yet. Use this while you set it up.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create programme' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/northfield/');
  });

  it('sends what was entered, then opens the new programme', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...manager(),
      ...reads,
      [api.createProgramme]: { status: 201, body: programme },
    });
    openConsole('/northfield/programmes/new');
    await heading('New programme');

    await user.type(title(), '  Community Spaces Fund ');
    await user.type(summary(), 'Grants for places where neighbours meet.');
    await user.click(screen.getByRole('radio', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Create programme' }));

    await heading('Community Spaces Fund');
    expect(sent.find(({ key }) => key === api.createProgramme)?.body).toEqual({
      title: 'Community Spaces Fund',
      summary: 'Grants for places where neighbours meet.',
      description: '',
      status: 'open',
    });
    expect(window.location.pathname).toBe(`/northfield/programmes/${programme.id}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says what is missing beside each field and in a summary, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...manager() });
    openConsole('/northfield/programmes/new');
    await heading('New programme');

    await user.click(screen.getByRole('button', { name: 'Create programme' }));

    const summaryBox = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(summaryBox)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Enter a title for the programme.', 'Enter a summary for applicants.']);
    expect(title().getAttribute('aria-invalid')).toBe('true');
    expect(title().getAttribute('aria-describedby')).toContain('title-error');
    expect(summary().getAttribute('aria-invalid')).toBe('true');
    expect(sent.map(({ key }) => key)).toEqual(['GET /auth/session']);
    await waitFor(() => {
      expect(document.activeElement).toBe(summaryBox);
    });
  });

  it("shows the API's words when it refuses the programme", async () => {
    const user = userEvent.setup();
    stubApi({
      ...manager(),
      [api.createProgramme]: problem(400, messages.fixFields, [
        { field: 'body.title', message: 'Give this programme a different title.' },
      ]),
    });
    openConsole('/northfield/programmes/new');
    await heading('New programme');
    await user.type(title(), 'Community Spaces Fund');
    await user.type(summary(), 'Grants.');

    await user.click(screen.getByRole('button', { name: 'Create programme' }));

    const summaryBox = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summaryBox).getByRole('link').textContent).toBe(
      'Give this programme a different title.',
    );
    expect(screen.getAllByText('Give this programme a different title.')).toHaveLength(2);
    expect(window.location.pathname).toBe('/northfield/programmes/new');
  });

  it('asks before leaving with entries that are not saved, and not when nothing was entered', async () => {
    const user = userEvent.setup();
    stubApi({ ...manager(), [api.programmes]: ok({ programmes: [] }) });
    openConsole('/northfield/programmes/new');
    await heading('New programme');
    await user.type(title(), 'Community');

    await user.click(screen.getByRole('link', { name: 'Cancel' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(title().value).toBe('Community');
    expect(window.location.pathname).toBe('/northfield/programmes/new');

    await user.clear(title());
    await user.click(screen.getByRole('link', { name: 'Cancel' }));
    await heading('Programmes');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('changing a programme', () => {
  const open = () => {
    openConsole(`/northfield/programmes/${programme.id}/edit`);
    return heading('Edit programme');
  };

  it('shows what is saved, and where it sits', async () => {
    stubApi({ ...manager(), ...reads });
    await open();

    await screen.findByDisplayValue('Community Spaces Fund');
    expect(summary().value).toBe('Grants for places where neighbours meet.');
    expect(description().value).toContain('Open to charities and community groups.');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Draft' }).checked).toBe(true);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(crumbs).getByRole('link', { name: 'Community Spaces Fund' }).getAttribute('href'),
    ).toBe(`/northfield/programmes/${programme.id}`);
    expect(screen.getByRole('link', { name: 'Back to programme' })).toBeTruthy();
  });

  it('saves the change, says so, and shows the new title in the breadcrumbs', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...manager(),
      ...reads,
      [api.updateProgramme]: (body) => ok({ ...programme, ...(body as object) }),
    });
    await open();
    await screen.findByDisplayValue('Community Spaces Fund');

    await user.clear(title());
    await user.type(title(), 'Community Places Fund');
    await user.click(screen.getByRole('radio', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Save programme' }));

    expect(await screen.findByText('Programme saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === api.updateProgramme)?.body).toEqual({
      title: 'Community Places Fund',
      summary: 'Grants for places where neighbours meet.',
      description: programme.description,
      status: 'open',
    });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Community Places Fund' })).toBeTruthy();
    await user.click(within(crumbs).getByRole('link', { name: 'Community Places Fund' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stops saying it is saved as soon as something changes again', async () => {
    const user = userEvent.setup();
    stubApi({ ...manager(), ...reads, [api.updateProgramme]: ok(programme) });
    await open();
    await screen.findByDisplayValue('Community Spaces Fund');
    await user.click(screen.getByRole('button', { name: 'Save programme' }));
    expect(await screen.findByText('Programme saved.')).toBeTruthy();

    await user.type(summary(), '!');

    expect(screen.queryByText('Programme saved.')).toBeNull();
  });

  it('shows the words for a programme that cannot be read, with a way to try again', async () => {
    stubApi({ ...manager(), [api.programme]: problem(404, 'We cannot find this programme.') });
    await open();

    expect(await screen.findByText('We cannot find this programme.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
