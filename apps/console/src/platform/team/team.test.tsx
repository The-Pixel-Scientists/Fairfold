// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok } from '../settings/testing.ts';
import { STEP_UP_NEEDED } from './change.ts';
import { SETTINGS, STEP_UP, TEAM, ada, base, invitation, marcus, priya, team } from './testing.ts';

setUpConsoleTests();

type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

async function openTeam(
  more: Handlers = {},
  members?: readonly unknown[],
  waiting?: readonly unknown[],
) {
  const sent = stubApi({ ...base(members, waiting), ...more });
  openConsole('/northfield/team');
  await heading('Team');
  await screen.findByRole('table', { name: 'Members of Northfield Foundation' });
  return sent;
}

const rowOf = (name: string | RegExp) => within(screen.getByRole('row', { name }));
const dialog = () => screen.findByRole('dialog');
const writes = (sent: { key: string }[]) =>
  sent.map(({ key }) => key).filter((key) => !key.startsWith('GET '));

describe('the team page', () => {
  it('lists members with their email, roles and status, and marks the signed-in person', async () => {
    await openTeam();

    const members = screen.getByRole('table', { name: 'Members of Northfield Foundation' });
    expect(within(members).getAllByRole('row').slice(1)).toHaveLength(3);
    const own = rowOf(/Ada Morgan/);
    expect(own.getByText('You')).toBeTruthy();
    expect(own.getByText('ada@example.org')).toBeTruthy();
    expect(own.getByText('Administrator')).toBeTruthy();
    expect(own.getByText('Active')).toBeTruthy();
    expect(rowOf(/Marcus Bell/).getByText('Programme manager')).toBeTruthy();
    expect(rowOf(/Marcus Bell/).getByText('Reviewer')).toBeTruthy();
    expect(rowOf(/Not named yet/).getByText('Suspended')).toBeTruthy();
    await expectTitle('Team – Fairfold Grants console');
  });

  it('offers no actions on the signed-in persons own row, and names who each action is for', async () => {
    await openTeam();

    expect(rowOf(/Ada Morgan/).queryAllByRole('button')).toEqual([]);
    const marcusRow = rowOf(/Marcus Bell/);
    expect(marcusRow.getByRole('button', { name: 'Change roles for Marcus Bell' })).toBeTruthy();
    expect(marcusRow.getByRole('button', { name: 'Suspend for Marcus Bell' })).toBeTruthy();
    expect(marcusRow.getByRole('button', { name: 'Remove for Marcus Bell' })).toBeTruthy();
    expect(
      rowOf(/Not named yet/).getByRole('button', { name: 'Reinstate for priya@example.org' }),
    ).toBeTruthy();
  });

  it('lists pending invitations with when they expire', async () => {
    await openTeam();

    const table = screen.getByRole('table', { name: 'Invitations waiting to be accepted' });
    const row = within(within(table).getAllByRole('row')[1] as HTMLElement);
    expect(row.getByText('fatima@example.org')).toBeTruthy();
    expect(row.getByText('Reviewer')).toBeTruthy();
    expect(row.getByText('4 November 2026, 5:00pm')).toBeTruthy();
    expect(screen.getByText(/1 invitation is waiting/)).toBeTruthy();
  });

  it('says how to invite someone when no invitation is waiting', async () => {
    const user = userEvent.setup();
    await openTeam({}, [ada], []);

    expect(screen.getByRole('heading', { level: 3, name: 'No invitations waiting' })).toBeTruthy();
    expect(screen.getByText(/enter their email address and pick their roles/)).toBeTruthy();
    const section = screen.getByRole('region', { name: 'Invitations waiting' });
    await user.click(within(section).getByRole('button', { name: 'Invite someone' }));
    expect(await screen.findByRole('dialog', { name: 'Invite someone' })).toBeTruthy();
  });

  it('is in the navigation for an administrator', async () => {
    await openTeam();

    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'Team',
    });
    expect(link.getAttribute('href')).toBe('/northfield/team');
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('tells someone without the permission, asks the API for nothing, and hides the link', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['programme_manager'] })) });
    openConsole('/northfield/team');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot manage the team' }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
        name: 'Team',
      }),
    ).toBeNull();
  });

  it('says why it failed, and tries again', async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubApi({
      ...base(),
      [TEAM]: () => {
        calls += 1;
        return calls === 1 ? problem(503, 'The service is busy. Try again in a minute.') : team();
      },
      [SETTINGS]: ok({
        name: 'Northfield Foundation',
        timeZone: 'Europe/London',
        fiscalYearStartMonth: 4,
      }),
    });
    openConsole('/northfield/team');

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('table', { name: 'Members of Northfield Foundation' }),
    ).toBeTruthy();
  });

  it('lists the keyboard shortcuts', async () => {
    const user = userEvent.setup();
    await openTeam();

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));

    expect(
      within(await dialog()).getByText('Change the roles of the person in the row'),
    ).toBeTruthy();
  });

  it('opens the roles of the focused row with Enter', async () => {
    const user = userEvent.setup();
    await openTeam();

    screen.getByRole('row', { name: /Marcus Bell/ }).focus();
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('dialog', { name: 'Change roles for Marcus Bell' }),
    ).toBeTruthy();
  });
});

describe('inviting someone', () => {
  const INVITE = 'POST /console/team/invitations';
  const invited = {
    id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    email: 'new@example.org',
    roles: ['programme_manager', 'reviewer'],
    expiresAt: '2026-11-05T09:00:00.000Z',
  };

  it('sends the address and roles, then says who was invited and lists the invitation', async () => {
    const user = userEvent.setup();
    const sent = await openTeam({ [INVITE]: { status: 201, body: invited } });

    await user.click(screen.getByRole('button', { name: 'Invite someone' }));
    const form = within(await dialog());
    await user.type(form.getByLabelText('Email address'), '  new@example.org ');
    await user.click(form.getByRole('checkbox', { name: /^Programme manager/ }));
    await user.click(form.getByRole('checkbox', { name: /^Reviewer/ }));
    await user.click(form.getByRole('button', { name: 'Send invitation' }));

    expect(
      await screen.findByText('Invitation sent to new@example.org. It works for 7 days.'),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.find(({ key }) => key === INVITE)?.body).toEqual({
      email: 'new@example.org',
      roles: ['programme_manager', 'reviewer'],
    });
    const table = screen.getByRole('table', { name: 'Invitations waiting to be accepted' });
    expect(within(table).getByText('new@example.org')).toBeTruthy();
    expect(screen.getByText(/2 invitations are waiting/)).toBeTruthy();
  });

  it('says what to fix beside the fields, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = await openTeam();

    await user.click(screen.getByRole('button', { name: 'Invite someone' }));
    const form = within(await dialog());
    await user.type(form.getByLabelText('Email address'), 'nobody');
    await user.click(form.getByRole('button', { name: 'Send invitation' }));

    expect((await form.findAllByText(/Enter an email address/)).length).toBeGreaterThan(0);
    expect(form.getAllByText('Choose at least one role.').length).toBeGreaterThan(0);
    expect(writes(sent)).toEqual([]);
  });

  it('shows what the API refused, and keeps what was typed', async () => {
    const user = userEvent.setup();
    await openTeam({ [INVITE]: problem(409, 'This person is already on the team.') });

    await user.click(screen.getByRole('button', { name: 'Invite someone' }));
    const form = within(await dialog());
    await user.type(form.getByLabelText('Email address'), 'marcus@example.org');
    await user.click(form.getByRole('checkbox', { name: /^Reviewer/ }));
    await user.click(form.getByRole('button', { name: 'Send invitation' }));

    expect(await form.findByText('This person is already on the team.')).toBeTruthy();
    expect(form.getByLabelText<HTMLInputElement>('Email address').value).toBe('marcus@example.org');
  });

  it('closes on Cancel without sending anything', async () => {
    const user = userEvent.setup();
    const sent = await openTeam();

    await user.click(screen.getByRole('button', { name: 'Invite someone' }));
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes(sent)).toEqual([]);
  });
});

describe('changing a member', () => {
  const MARCUS = `/console/team/members/${marcus.id}`;

  it('changes roles from a dialog with their labels, and shows the new roles', async () => {
    const user = userEvent.setup();
    const sent = await openTeam({
      [`PUT ${MARCUS}/roles`]: ok({ ...marcus, roles: ['tenant_admin'] }),
    });

    await user.click(screen.getByRole('button', { name: 'Change roles for Marcus Bell' }));
    const form = within(
      await screen.findByRole('dialog', { name: 'Change roles for Marcus Bell' }),
    );
    expect(form.getByRole<HTMLInputElement>('checkbox', { name: /^Reviewer/ }).checked).toBe(true);
    await user.click(form.getByRole('checkbox', { name: /^Administrator/ }));
    await user.click(form.getByRole('checkbox', { name: /^Programme manager/ }));
    await user.click(form.getByRole('checkbox', { name: /^Reviewer/ }));
    await user.click(form.getByRole('button', { name: 'Save roles' }));

    expect(await screen.findByText('Roles changed for Marcus Bell: Administrator.')).toBeTruthy();
    expect(sent.find(({ key }) => key === `PUT ${MARCUS}/roles`)?.body).toEqual({
      roles: ['tenant_admin'],
    });
    expect(rowOf(/Marcus Bell/).getByText('Administrator')).toBeTruthy();
  });

  it('will not save a member with no role', async () => {
    const user = userEvent.setup();
    const sent = await openTeam();

    await user.click(screen.getByRole('button', { name: 'Change roles for Marcus Bell' }));
    const form = within(await dialog());
    await user.click(form.getByRole('checkbox', { name: /^Programme manager/ }));
    await user.click(form.getByRole('checkbox', { name: /^Reviewer/ }));
    await user.click(form.getByRole('button', { name: 'Save roles' }));

    expect((await form.findAllByText('Choose at least one role.')).length).toBeGreaterThan(0);
    expect(writes(sent)).toEqual([]);
  });

  it('says they will be signed out before suspending, then marks them suspended', async () => {
    const user = userEvent.setup();
    const sent = await openTeam({
      [`POST ${MARCUS}/suspend`]: ok({ ...marcus, status: 'suspended' }),
    });

    await user.click(screen.getByRole('button', { name: 'Suspend for Marcus Bell' }));
    const confirm = await screen.findByRole('dialog', { name: 'Suspend Marcus Bell?' });
    expect(confirm.textContent).toContain('They will be signed out of Northfield Foundation now');
    expect(writes(sent)).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: 'Suspend Marcus Bell' }));

    expect(await screen.findByText('Marcus Bell is suspended and signed out.')).toBeTruthy();
    expect(rowOf(/Marcus Bell/).getByText('Suspended')).toBeTruthy();
    expect(
      rowOf(/Marcus Bell/).getByRole('button', { name: 'Reinstate for Marcus Bell' }),
    ).toBeTruthy();
  });

  it('reinstates a suspended member after confirming', async () => {
    const user = userEvent.setup();
    await openTeam({
      [`POST /console/team/members/${priya.id}/reinstate`]: ok({ ...priya, status: 'active' }),
    });

    await user.click(screen.getByRole('button', { name: 'Reinstate for priya@example.org' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reinstate priya@example.org?' });
    expect(confirm.textContent).toContain('sign in to Northfield Foundation again');
    await user.click(within(confirm).getByRole('button', { name: 'Reinstate priya@example.org' }));

    expect(await screen.findByText('priya@example.org can sign in again.')).toBeTruthy();
    expect(rowOf(/priya@example.org/).getByText('Active')).toBeTruthy();
  });

  it('removes a member after confirming, and moves focus to the list', async () => {
    const user = userEvent.setup();
    await openTeam({ [`DELETE ${MARCUS}`]: { status: 204 } });

    await user.click(screen.getByRole('button', { name: 'Remove for Marcus Bell' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Remove Marcus Bell from the team?',
    });
    expect(confirm.textContent).toContain('signed out of Northfield Foundation now');
    await user.click(within(confirm).getByRole('button', { name: 'Remove Marcus Bell' }));

    expect(
      await screen.findByText('Marcus Bell is removed from the team and signed out.'),
    ).toBeTruthy();
    expect(screen.queryByRole('row', { name: /Marcus Bell/ })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Members' }),
      );
    });
  });

  it('revokes an invitation after confirming', async () => {
    const user = userEvent.setup();
    await openTeam({ [`DELETE /console/team/invitations/${invitation.id}`]: { status: 204 } });

    await user.click(
      screen.getByRole('button', { name: 'Revoke invitation to fatima@example.org' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: 'Revoke the invitation to fatima@example.org?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Revoke invitation' }));

    expect(
      await screen.findByText('The invitation to fatima@example.org is revoked.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'No invitations waiting' })).toBeTruthy();
  });

  it('shows what the API refused inside the confirmation, and leaves the list alone', async () => {
    const user = userEvent.setup();
    await openTeam({ [`DELETE ${MARCUS}`]: problem(404, 'This person is not on the team.') });

    await user.click(screen.getByRole('button', { name: 'Remove for Marcus Bell' }));
    const confirm = within(await dialog());
    await user.click(confirm.getByRole('button', { name: 'Remove Marcus Bell' }));

    expect(await confirm.findByRole('alert')).toBeTruthy();
    expect(confirm.getByText('This person is not on the team.')).toBeTruthy();
  });
});

describe('confirming it is them', () => {
  const SUSPEND = `POST /console/team/members/${marcus.id}/suspend`;

  function refusedOnce(): Handlers {
    let calls = 0;
    return {
      [SUSPEND]: () => {
        calls += 1;
        return calls === 1 ? problem(403, STEP_UP_NEEDED) : ok({ ...marcus, status: 'suspended' });
      },
      [STEP_UP]: ok(administrator()),
    };
  }

  async function suspend(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Suspend for Marcus Bell' }));
    const confirm = await screen.findByRole('dialog', { name: 'Suspend Marcus Bell?' });
    await user.click(within(confirm).getByRole('button', { name: 'Suspend Marcus Bell' }));
  }

  async function confirmItIsYou(user: ReturnType<typeof userEvent.setup>) {
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.type(step.getByLabelText('Password'), 'correct horse battery');
    await user.type(step.getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(step.getByRole('button', { name: 'Confirm it is you' }));
    return step;
  }

  it('asks for the password and a code, then repeats the action once', async () => {
    const user = userEvent.setup();
    const sent = await openTeam(refusedOnce());

    await suspend(user);
    await screen.findByRole('dialog', { name: 'Confirm it is you' });
    expect(screen.queryByRole('dialog', { name: 'Suspend Marcus Bell?' })).toBeNull();
    await confirmItIsYou(user);

    expect(await screen.findByText('Marcus Bell is suspended and signed out.')).toBeTruthy();
    expect(writes(sent)).toEqual([SUSPEND, STEP_UP, SUSPEND]);
    expect(sent.find(({ key }) => key === STEP_UP)?.body).toEqual({
      password: 'correct horse battery',
      code: '123456',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('brings the confirmation back when they cancel, and does not repeat the action', async () => {
    const user = userEvent.setup();
    const sent = await openTeam(refusedOnce());

    await suspend(user);
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.click(step.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('dialog', { name: 'Suspend Marcus Bell?' })).toBeTruthy();
    expect(writes(sent)).toEqual([SUSPEND]);
  });

  it('says in the step-up dialog when the password or code is not right', async () => {
    const user = userEvent.setup();
    const sent = await openTeam({ ...refusedOnce(), [STEP_UP]: problem(401, 'No.') });

    await suspend(user);
    const step = await confirmItIsYou(user);

    expect((await step.findAllByText(/Your password or code is not right/)).length).toBeGreaterThan(
      0,
    );
    expect(writes(sent)).toEqual([SUSPEND, STEP_UP]);
  });

  it('asks only once: a second refusal after confirming is shown, not asked again', async () => {
    const user = userEvent.setup();
    await openTeam({ [SUSPEND]: problem(403, STEP_UP_NEEDED), [STEP_UP]: ok(administrator()) });

    await suspend(user);
    await confirmItIsYou(user);

    const confirm = await screen.findByRole('dialog', { name: 'Suspend Marcus Bell?' });
    expect(await within(confirm).findByText(STEP_UP_NEEDED)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Confirm it is you' })).toBeNull();
  });
});
