// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem } from '../../testing/api.ts';
import { setUpConsoleTests } from '../../testing/render.tsx';
import { administrator, heading, ok } from '../settings/testing.ts';
import {
  PARTY,
  READ_ERASURE,
  REQUEST,
  REQUEST_ERASURE,
  STEP_UP,
  confirmItIsYou,
  expectNothingKept,
  open,
} from './testing.ts';

setUpConsoleTests();

const requested = { id: REQUEST, requestedAt: '2026-11-10T09:00:00.000Z' };
const button = () => screen.getByRole('button', { name: 'Erase personal data for Amara Okafor' });

async function openConfirmation(more = {}) {
  const user = userEvent.setup();
  const sent = open(`/settings/subject-access/people/${PARTY}/erasure`, {
    [STEP_UP]: ok(administrator()),
    ...more,
  });
  await confirmItIsYou(user);
  await screen.findByRole('form', { name: 'Erase personal data for Amara Okafor' });
  return { user, sent };
}

describe('the erasure confirmation', () => {
  it('asks it is them first, before any choice is offered', async () => {
    const user = userEvent.setup();
    open(`/settings/subject-access/people/${PARTY}/erasure`, { [STEP_UP]: ok(administrator()) });

    await screen.findByRole('dialog', { name: 'Confirm it is you' });
    expect(screen.queryByRole('radio', { name: /The person asked/ })).toBeNull();
    await confirmItIsYou(user);
    expect(await screen.findByRole('radio', { name: /The person asked/ })).toBeTruthy();
  });

  it('goes back to the person when they cancel', async () => {
    const user = userEvent.setup();
    open(`/settings/subject-access/people/${PARTY}/erasure`);

    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.click(step.getByRole('button', { name: 'Cancel' }));

    await heading('Amara Okafor');
    expect(window.location.pathname).toBe(`/northfield/settings/subject-access/people/${PARTY}`);
  });

  it('names the person and says exactly what will happen', async () => {
    await openConfirmation();

    expect(screen.getByText('What happens when you erase Amara Okafor')).toBeTruthy();
    expect(screen.getByText(/including tools that are switched off/)).toBeTruthy();
    expect(screen.getByText(/record is kept but marked as erased/)).toBeTruthy();
    expect(screen.getByText(/audit trail are kept, with ids and codes only/)).toBeTruthy();
    expect(screen.getByText(/No outcome changes/)).toBeTruthy();
    expect(screen.getByText(/restoring a backup does not bring the data back/)).toBeTruthy();
    expect(screen.getByText('It cannot be undone.')).toBeTruthy();
    expectNothingKept();
  });

  it('keeps the button blocked until a reason is chosen and the box is ticked', async () => {
    const { user } = await openConfirmation();

    expect((button() as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: /The person asked/ }));
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'I understand this cannot be undone' }));
    expect((button() as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the party id, the reason and the literal confirmation, then opens the status', async () => {
    const { user, sent } = await openConfirmation({
      [REQUEST_ERASURE]: { status: 202, body: { requestId: REQUEST } },
      [READ_ERASURE]: ok({ ...requested, status: 'queued' }),
    });

    await user.click(screen.getByRole('radio', { name: /The person asked/ }));
    await user.click(screen.getByRole('checkbox', { name: 'I understand this cannot be undone' }));
    await user.click(button());

    await heading('Erasure');
    expect(sent.find(({ key }) => key === REQUEST_ERASURE)?.body).toEqual({
      partyId: PARTY,
      reason: 'subject_request',
      confirm: true,
    });
    expect(window.location.pathname).toBe(
      `/northfield/settings/subject-access/erasures/${REQUEST}`,
    );
  });

  it('shows the servers refusal, such as a member of staff, in the error summary', async () => {
    const words = 'This person is a member of your team. Remove their membership first.';
    const { user } = await openConfirmation({ [REQUEST_ERASURE]: problem(409, words) });

    await user.click(screen.getByRole('radio', { name: /Your funder has decided/ }));
    await user.click(screen.getByRole('checkbox', { name: 'I understand this cannot be undone' }));
    await user.click(button());

    expect(within(await screen.findByRole('alert')).getByText(words)).toBeTruthy();
  });

  it('shows not found when the person cannot be read', async () => {
    const user = userEvent.setup();
    open(`/settings/subject-access/people/${PARTY}/erasure`, {
      [STEP_UP]: ok(administrator()),
      [`GET /console/crm/people/${PARTY}`]: problem(404, 'Not found.'),
    });
    await confirmItIsYou(user);
    expect(await heading('Not found')).toBeTruthy();
  });
});

describe('the erasure status page', () => {
  const at = (answer: unknown) =>
    open(`/settings/subject-access/erasures/${REQUEST}`, { [READ_ERASURE]: ok(answer) });

  it('says it is queued or running', async () => {
    at({ ...requested, status: 'running' });
    expect(await screen.findByText('The erasure is running')).toBeTruthy();
  });

  it('reads done on first load with counts by tool and table and no values', async () => {
    at({
      ...requested,
      status: 'done',
      counts: { 'party.person': 1, 'grants.application_answer': 12, 'crm.interaction': 0 },
    });

    expect(await screen.findByText('The personal data is erased')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Rows changed by tool and table' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'CrmInteraction0',
      'GrantsApplication answer12',
      'PartyPerson1',
    ]);
    expect(screen.getByText(/shows no values/)).toBeTruthy();
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toBe('');
  });

  it('says nothing was erased when it failed', async () => {
    at({ ...requested, status: 'failed', failureCode: 'job_failed' });
    expect(await screen.findByText('The erasure did not finish')).toBeTruthy();
    expect(
      screen.getByText(/Nothing was erased, because the whole erasure is rolled back/),
    ).toBeTruthy();
  });

  it('shows not found for a request the server will not show', async () => {
    open(`/settings/subject-access/erasures/${REQUEST}`, {
      [READ_ERASURE]: problem(404, 'Not found.'),
    });
    expect(await heading('Not found')).toBeTruthy();
  });

  it('announces the change to done once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    open(`/settings/subject-access/erasures/${REQUEST}`, {
      [READ_ERASURE]: () => {
        reads += 1;
        return ok(
          reads === 1
            ? { ...requested, status: 'queued' }
            : { ...requested, status: 'done', counts: {} },
        );
      },
    });
    await screen.findByText('The erasure is queued');

    await vi.advanceTimersByTimeAsync(3100);

    await waitFor(() => {
      expect(document.querySelector('[role="status"].sr-only')?.textContent).toBe(
        'The personal data is erased.',
      );
    });
    expect(screen.getByRole('heading', { name: 'No rows needed changing' })).toBeTruthy();
  });
});
