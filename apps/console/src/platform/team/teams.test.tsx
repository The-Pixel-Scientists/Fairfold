// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok } from '../settings/testing.ts';
import { STEP_UP_NEEDED } from './change.ts';
import { STEP_UP, ada, marcus, priya } from './testing.ts';

setUpConsoleTests();

type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

const LIST = 'GET /console/teams';
const TEAM = 'GET /console/team';
const casework = {
  id: '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8',
  name: 'Casework',
  memberCount: 2,
  archivedAt: null,
};
const legacy = {
  id: '6c2d3e4f-5061-4b72-9c83-a4b5c6d7e8f9',
  name: 'Legacy panel',
  memberCount: 0,
  archivedAt: '2026-10-01T09:00:00.000Z',
};
const DETAIL = `/console/teams/${casework.id}`;
const detail = {
  ...casework,
  members: [
    { membershipId: ada.id, name: 'Ada Morgan', status: 'active' },
    { membershipId: priya.id, name: null, status: 'suspended' },
  ],
};

/** After a change that removes the button that opened the dialog, focus must not fall to the page. */
async function expectFocusKept() {
  await waitFor(() => {
    expect(document.activeElement?.getAttribute('role')).toBe('status');
  });
  expect(document.activeElement).not.toBe(document.body);
}

const created = (body: unknown): Reply => ({ status: 201, body });
const listOf = (...teams: unknown[]) => ({ [LIST]: ok({ teams }) });
const written = (sent: { key: string }[]) =>
  sent.map(({ key }) => key).filter((key) => !key.startsWith('GET '));

async function openTeams(more: Handlers = {}, teams: unknown[] = [casework, legacy]) {
  const sent = stubApi({ [SESSION]: ok(administrator()), ...listOf(...teams), ...more });
  openConsole('/northfield/teams');
  await heading('Teams');
  await screen.findAllByRole('button', { name: 'Create team' });
  return sent;
}

async function openDetail(more: Handlers = {}, body: unknown = detail) {
  const sent = stubApi({
    [SESSION]: ok(administrator()),
    [`GET ${DETAIL}`]: ok(body),
    [TEAM]: ok({ members: [ada, marcus, priya], invitations: [] }),
    ...more,
  });
  openConsole(`/northfield/teams/${casework.id}`);
  await heading('Casework');
  await waitFor(() => {
    expect(screen.queryByText('Loading the team')).toBeNull();
  });
  return sent;
}

describe('the teams page', () => {
  it('lists teams with member counts, and keeps archived teams behind a filter', async () => {
    const user = userEvent.setup();
    await openTeams();

    const table = screen.getByRole('table', { name: 'Teams' });
    const row = within(within(table).getByRole('row', { name: /Casework/ }));
    expect(row.getByRole('link', { name: 'Casework' }).getAttribute('href')).toBe(
      `/northfield/teams/${casework.id}`,
    );
    expect(row.getByText('2')).toBeTruthy();
    expect(screen.queryByText('Legacy panel')).toBeNull();
    expect(screen.getByText(/does not give anyone a permission/)).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Show archived teams' }));
    const archived = within(screen.getByRole('row', { name: /Legacy panel/ }));
    expect(archived.getByText('Archived')).toBeTruthy();
    expect(archived.queryByRole('button')).toBeNull();
    await expectTitle('Teams – Fairfold Grants console');
  });

  it('says what a team is for and how to create one when there are none', async () => {
    const user = userEvent.setup();
    await openTeams({}, []);

    expect(screen.getByRole('heading', { level: 2, name: 'No teams yet' })).toBeTruthy();
    expect(screen.getByText(/group of members that records can be assigned to/)).toBeTruthy();
    const section = screen.getByRole('heading', { name: 'No teams yet' })
      .parentElement as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Create team' }));
    expect(await screen.findByRole('dialog', { name: 'Create team' })).toBeTruthy();
  });

  it('tells someone without the permission, and asks the API for nothing', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['programme_manager'] })) });
    openConsole('/northfield/teams');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot manage teams' }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
  });

  it('shows why the list did not load, and tries again', async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubApi({
      [SESSION]: ok(administrator()),
      [LIST]: () => {
        calls += 1;
        return calls === 1
          ? problem(500, 'The teams could not be read.')
          : ok({ teams: [casework] });
      },
    });
    openConsole('/northfield/teams');

    expect(await screen.findByText('The teams could not be read.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Teams' })).toBeTruthy();
  });

  it('creates a team and sends one idempotency key', async () => {
    const user = userEvent.setup();
    const sent = await openTeams({
      'POST /console/teams': (body) =>
        created({
          ...casework,
          id: '7d3e4f50-6172-4c83-8d94-b5c6d7e8f90a',
          name: (body as { name: string }).name,
          memberCount: 0,
        }),
    });

    await user.click(screen.getByRole('button', { name: 'Create team' }));
    const form = within(await screen.findByRole('dialog', { name: 'Create team' }));
    expect(form.getByText(/It does not give anyone a permission/)).toBeTruthy();
    await user.type(form.getByLabelText('Team name'), '  Safeguarding  ');
    await user.click(form.getByRole('button', { name: 'Create team' }));

    expect(
      await screen.findByText('Team Safeguarding created. It has no members yet.'),
    ).toBeTruthy();
    expect(sent.find(({ key }) => key === 'POST /console/teams')?.body).toEqual({
      name: 'Safeguarding',
    });
    expect(screen.getByRole('row', { name: /Safeguarding/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a name that is missing or too long in the summary and beside the field', async () => {
    const user = userEvent.setup();
    const sent = await openTeams();

    await user.click(screen.getByRole('button', { name: 'Create team' }));
    const form = within(await screen.findByRole('dialog', { name: 'Create team' }));
    await user.click(form.getByRole('button', { name: 'Create team' }));
    expect((await form.findAllByText('Enter a team name.')).length).toBe(2);

    await user.type(form.getByLabelText('Team name'), 'x'.repeat(101));
    await user.click(form.getByRole('button', { name: 'Create team' }));
    expect((await form.findAllByText('Enter a team name of 100 characters or fewer.')).length).toBe(
      2,
    );
    expect(written(sent)).toEqual([]);
  });

  it('shows what the server refused beside the field', async () => {
    const user = userEvent.setup();
    await openTeams({
      'POST /console/teams': problem(409, 'A team with this name already exists.', [
        { field: 'body.name', message: 'Choose a name no active team uses.' },
      ]),
    });

    await user.click(screen.getByRole('button', { name: 'Create team' }));
    const form = within(await screen.findByRole('dialog', { name: 'Create team' }));
    await user.type(form.getByLabelText('Team name'), 'Casework');
    await user.click(form.getByRole('button', { name: 'Create team' }));
    expect((await form.findAllByText('Choose a name no active team uses.')).length).toBe(2);
  });

  it('renames a team', async () => {
    const user = userEvent.setup();
    const sent = await openTeams({
      [`PATCH /console/teams/${casework.id}`]: ok({ ...casework, name: 'Case team' }),
    });

    await user.click(screen.getByRole('button', { name: 'Rename Casework' }));
    const form = within(await screen.findByRole('dialog', { name: 'Rename Casework' }));
    const input = form.getByLabelText<HTMLInputElement>('Team name');
    expect(input.value).toBe('Casework');
    await user.clear(input);
    await user.type(input, 'Case team');
    await user.click(form.getByRole('button', { name: 'Rename team' }));

    expect(await screen.findByText('Team renamed to Case team.')).toBeTruthy();
    expect(written(sent)).toEqual([`PATCH /console/teams/${casework.id}`]);
    expect(screen.getByRole('link', { name: 'Case team' })).toBeTruthy();
  });

  it('archives a team after saying what happens', async () => {
    const user = userEvent.setup();
    await openTeams({
      [`POST /console/teams/${casework.id}/archive`]: ok({
        ...casework,
        archivedAt: '2026-11-20T09:00:00.000Z',
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Archive Casework' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Archive Casework?' }));
    expect(confirm.getByText(/will no longer see records assigned to it/)).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Archive team' }));

    expect(await screen.findByText('Team Casework is archived.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Casework/ })).toBeNull();
    });
    await expectFocusKept();
  });

  it('keeps focus on the message after creating the first team from the empty state', async () => {
    const user = userEvent.setup();
    await openTeams(
      {
        'POST /console/teams': (body) =>
          created({ ...casework, name: (body as { name: string }).name, memberCount: 0 }),
      },
      [],
    );

    const empty = screen.getByRole('heading', { name: 'No teams yet' })
      .parentElement as HTMLElement;
    await user.click(within(empty).getByRole('button', { name: 'Create team' }));
    const form = within(await screen.findByRole('dialog', { name: 'Create team' }));
    await user.type(form.getByLabelText('Team name'), 'Safeguarding');
    await user.click(form.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByRole('row', { name: /Safeguarding/ })).toBeTruthy();
    await expectFocusKept();
  });

  it('asks the person to confirm it is them, then makes the change once more', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const sent = await openTeams({
      [`POST /console/teams/${casework.id}/archive`]: () => {
        calls += 1;
        return calls === 1
          ? problem(403, STEP_UP_NEEDED)
          : ok({ ...casework, archivedAt: '2026-11-20T09:00:00.000Z' });
      },
      [STEP_UP]: ok(administrator()),
    });

    await user.click(screen.getByRole('button', { name: 'Archive Casework' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Archive Casework?' }));
    await user.click(confirm.getByRole('button', { name: 'Archive team' }));
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.type(step.getByLabelText('Password'), 'correct horse battery');
    await user.type(step.getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(step.getByRole('button', { name: 'Confirm it is you' }));

    expect(await screen.findByText('Team Casework is archived.')).toBeTruthy();
    const archive = `POST /console/teams/${casework.id}/archive`;
    expect(written(sent)).toEqual([archive, STEP_UP, archive]);
  });

  it('leaves the dialog open and changes nothing when step-up is cancelled', async () => {
    const user = userEvent.setup();
    const archive = `POST /console/teams/${casework.id}/archive`;
    const sent = await openTeams({ [archive]: problem(403, STEP_UP_NEEDED) });

    await user.click(screen.getByRole('button', { name: 'Archive Casework' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Archive Casework?' })).getByRole('button', {
        name: 'Archive team',
      }),
    );
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.click(step.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('dialog', { name: 'Archive Casework?' })).toBeTruthy();
    expect(written(sent)).toEqual([archive]);
  });

  it('says what a refusal means without the team name', async () => {
    const user = userEvent.setup();
    await openTeams({
      [`POST /console/teams/${casework.id}/archive`]: problem(404, 'This team was not found.'),
    });

    await user.click(screen.getByRole('button', { name: 'Archive Casework' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Archive Casework?' }));
    await user.click(confirm.getByRole('button', { name: 'Archive team' }));
    expect(await confirm.findByRole('alert')).toHaveProperty(
      'textContent',
      'This team was not found.',
    );
  });
});

describe('a team', () => {
  it('lists its members by name and status, with no email', async () => {
    await openDetail();

    const table = screen.getByRole('table', { name: 'Members of Casework' });
    expect(within(table).getByText('Ada Morgan')).toBeTruthy();
    expect(within(table).getByText('Not named yet')).toBeTruthy();
    expect(within(table).getByText('Suspended')).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toMatch(/@example\.org/);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByText(/does not give anyone a permission/)).toBeTruthy();
  });

  it('adds a member chosen by name and role, never by email', async () => {
    const user = userEvent.setup();
    const sent = await openDetail({
      [`PUT ${DETAIL}/members/${marcus.id}`]: { status: 204 },
    });

    await user.click(screen.getByRole('button', { name: 'Add member' }));
    const form = within(await screen.findByRole('dialog', { name: 'Add a member to Casework' }));
    expect(form.getByText(/Their permissions do not change/)).toBeTruthy();
    const options = within(form.getByRole('combobox', { name: 'Member' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Choose a member',
      'Marcus Bell (Programme manager, Reviewer)',
    ]);
    await user.click(form.getByRole('button', { name: 'Add member' }));
    expect((await form.findAllByText('Choose a member to add.')).length).toBe(2);

    await user.selectOptions(form.getByRole('combobox', { name: 'Member' }), marcus.id);
    await user.click(form.getByRole('button', { name: 'Add member' }));

    expect(await screen.findByText('Marcus Bell is in Casework.')).toBeTruthy();
    expect(written(sent)).toEqual([`PUT ${DETAIL}/members/${marcus.id}`]);
    expect(within(screen.getByRole('table')).getByText('Marcus Bell')).toBeTruthy();
  });

  it('removes a member after saying what changes for them', async () => {
    const user = userEvent.setup();
    await openDetail({ [`DELETE ${DETAIL}/members/${ada.id}`]: { status: 204 } });

    await user.click(screen.getByRole('button', { name: 'Remove from team for Ada Morgan' }));
    const confirm = within(
      await screen.findByRole('dialog', { name: 'Remove Ada Morgan from Casework?' }),
    );
    expect(
      confirm.getByText('Ada Morgan will no longer see records assigned to Casework.'),
    ).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Remove from team' }));

    expect(await screen.findByText('Ada Morgan is no longer in Casework.')).toBeTruthy();
    expect(within(screen.getByRole('table')).queryByText('Ada Morgan')).toBeNull();
    await expectFocusKept();
  });

  it('keeps focus on the message after adding the first member to an empty team', async () => {
    const user = userEvent.setup();
    await openDetail(
      { [`PUT ${DETAIL}/members/${marcus.id}`]: { status: 204 } },
      { ...casework, memberCount: 0, members: [] },
    );

    const empty = screen.getByRole('heading', { name: 'No one is in this team' })
      .parentElement as HTMLElement;
    await user.click(within(empty).getByRole('button', { name: 'Add member' }));
    const form = within(await screen.findByRole('dialog', { name: 'Add a member to Casework' }));
    await user.selectOptions(form.getByRole('combobox', { name: 'Member' }), marcus.id);
    await user.click(form.getByRole('button', { name: 'Add member' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    await expectFocusKept();
  });

  it('says how to add the first member of an empty team', async () => {
    await openDetail({}, { ...casework, memberCount: 0, members: [] });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'No one is in this team' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add member' }).length).toBe(2);
  });

  it('offers no changes to an archived team', async () => {
    await openDetail({}, { ...detail, archivedAt: legacy.archivedAt });
    expect(screen.getByText('This team is archived')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove from team/ })).toBeNull();
  });

  it('shows the not found words when the team is out of reach', async () => {
    stubApi({
      [SESSION]: ok(administrator()),
      [`GET ${DETAIL}`]: problem(404, 'This page was not found.'),
    });
    openConsole(`/northfield/teams/${casework.id}`);
    expect(await screen.findByText('This page was not found.')).toBeTruthy();
  });
});
