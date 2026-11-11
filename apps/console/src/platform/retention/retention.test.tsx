// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok } from '../settings/testing.ts';
import { STEP_UP_NEEDED } from '../team/change.ts';
import { periodWords } from './period.ts';

setUpConsoleTests();

const LIST = 'GET /console/retention-policies';
const CHANGE = 'PUT /console/retention-policies?policyId=audit';
const STEP_UP = 'POST /auth/step-up';

const audit = {
  policyId: 'audit',
  labelKey: 'audit',
  days: 2555,
  minimumDays: 365,
  defaultDays: 2555,
  changed: false,
};
const notes = {
  policyId: 'notes',
  labelKey: 'notes',
  days: 35,
  minimumDays: 30,
  defaultDays: 60,
  changed: true,
};

type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

async function openRetention(more: Handlers = {}, session = administrator(), loads = true) {
  const sent = stubApi({
    [SESSION]: ok(session),
    [LIST]: ok({ policies: [audit, notes] }),
    ...more,
  });
  openConsole('/northfield/settings/retention');
  await heading('Data retention');
  if (loads) await screen.findByRole('table');
  return sent;
}

const rowOf = (name: RegExp) => within(screen.getByRole('row', { name }));

async function change(user: ReturnType<typeof userEvent.setup>, days: string) {
  await user.click(screen.getByRole('button', { name: 'Change period for Audit log' }));
  const field = await screen.findByLabelText(/Days to keep audit log/);
  await user.clear(field);
  await user.type(field, days);
  await user.click(screen.getByRole('button', { name: 'Save period' }));
}

describe('periodWords', () => {
  it('uses whole years when it can and days otherwise', () => {
    expect(periodWords(2555)).toBe('7 years');
    expect(periodWords(365)).toBe('1 year');
    expect(periodWords(35)).toBe('35 days');
    expect(periodWords(1)).toBe('1 day');
  });
});

describe('the retention page', () => {
  it('lists each policy with its period, minimum, default and who set it', async () => {
    await openRetention();

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(2);
    const first = rowOf(/Audit log/);
    expect(first.getByText('7 years', { selector: 'td:nth-child(2)' })).toBeTruthy();
    expect(first.getAllByText(/2,555 days/).length).toBeGreaterThan(0);
    expect(first.getByText('1 year')).toBeTruthy();
    expect(first.getByText('Default')).toBeTruthy();
    const second = rowOf(/notes/);
    expect(second.getByText('Your funder')).toBeTruthy();
    expect(second.getByText(/^35 days/)).toBeTruthy();
    await expectTitle('Data retention – Fairfold Grants console');
  });

  it('says what the minimum, the nightly job and a change mean', async () => {
    await openRetention();

    expect(screen.getByText(/cannot lower a period below it/)).toBeTruthy();
    expect(screen.getByText(/nightly job deletes or anonymises/)).toBeTruthy();
    expect(screen.getByText(/shorter period applies from the next nightly run/)).toBeTruthy();
    expect(screen.getByText(/only to events recorded after the change/)).toBeTruthy();
  });

  it('shows a way to try again when the list cannot be read', async () => {
    await openRetention({ [LIST]: problem(500, 'The service failed.') }, administrator(), false);
    expect(await screen.findByText('The service failed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('saves a period, updates the row, announces it and returns focus to the row', async () => {
    const user = userEvent.setup();
    const sent = await openRetention({ [CHANGE]: ok({ ...audit, days: 3650, changed: true }) });

    await change(user, '3650');

    expect(await screen.findByText('Audit log period saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === CHANGE)?.body).toEqual({ days: 3650 });
    expect(rowOf(/Audit log/).getByText('10 years')).toBeTruthy();
    expect(rowOf(/Audit log/).getByText('Your funder')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Change period for Audit log' }),
      );
    });
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('refuses a period that is not whole days before sending it', async () => {
    const user = userEvent.setup();
    const sent = await openRetention();

    await change(user, '0');

    expect(
      (await screen.findAllByText('Enter a whole number of days from 1 to 36,500.')).length,
    ).toBeGreaterThan(0);
    expect(sent.some(({ key }) => key === CHANGE)).toBe(false);
  });

  it('shows the servers refusal below the minimum at the field and never echoes the value', async () => {
    const user = userEvent.setup();
    const words = 'This is shorter than the platform allows for this data. Enter 365 days or more.';
    await openRetention({
      [CHANGE]: problem(400, words, [{ field: 'body.days', message: words }]),
    });

    await change(user, '100');

    const summary = await screen.findByRole('alert');
    expect(within(summary).getByText(words)).toBeTruthy();
    expect(screen.getAllByText(words).length).toBeGreaterThan(1);
    expect(screen.queryByText(/\b100\b days/)).toBeNull();
  });

  it('asks it is them when the server needs it, keeps what was typed and repeats once', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const sent = await openRetention({
      [CHANGE]: () => {
        calls += 1;
        return calls === 1
          ? problem(403, STEP_UP_NEEDED)
          : ok({ ...audit, days: 730, changed: true });
      },
      [STEP_UP]: ok(administrator()),
    });

    await change(user, '730');
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.type(step.getByLabelText('Password'), 'correct horse battery');
    await user.type(step.getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(step.getByRole('button', { name: 'Confirm it is you' }));

    expect(await screen.findByText('Audit log period saved.')).toBeTruthy();
    expect(sent.filter(({ key }) => key !== LIST && key !== SESSION).map(({ key }) => key)).toEqual(
      [CHANGE, STEP_UP, CHANGE],
    );
    expect(sent.filter(({ key }) => key === CHANGE).map(({ body }) => body)).toEqual([
      { days: 730 },
      { days: 730 },
    ]);
  });

  it('says how long to wait after too many attempts', async () => {
    const user = userEvent.setup();
    await openRetention({
      [CHANGE]: {
        ...problem(429, 'Too many requests.'),
        headers: { 'retry-after': '30' },
      },
    });

    await change(user, '730');

    expect(
      await screen.findAllByText('Too many attempts. Wait 30 seconds, then try again.'),
    ).toBeTruthy();
  });

  it('shows no link to a member without the permission, and the servers answer at the address', async () => {
    await openRetention(
      { [LIST]: problem(403, 'You do not have permission to do this.') },
      consoleSession({ roles: ['programme_manager'] }),
      false,
    );

    expect(await screen.findByText('You do not have permission to do this.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Data retention' })).toBeNull();
  });
});
