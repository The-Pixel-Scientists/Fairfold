// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { titleSuffix } from '../product.ts';
import { problem, stubApi } from '../testing/api.ts';
import { containing } from '../testing/names.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
import {
  api,
  heading,
  ids,
  manager,
  ok,
  pounds,
  programme,
  reads,
  round,
  nth,
} from './fixtures.ts';
import type { Handlers } from './fixtures.ts';

setUpConsoleTests();

const box = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });

/** The day, month and year boxes of a date, and the time beside it. */
async function enter(user: UserEvent, word: 'Opening' | 'Closing', date: string, time: string) {
  const [day = '', month = '', year = ''] = date.split(' ');
  const group = screen.getByRole('group', { name: containing(`${word} date`) });
  await user.type(within(group).getByRole('textbox', { name: 'Day' }), day);
  await user.type(within(group).getByRole('textbox', { name: 'Month' }), month);
  await user.type(within(group).getByRole('textbox', { name: 'Year' }), year);
  fireEvent.change(screen.getByLabelText(`${word} time`), { target: { value: time } });
}

async function fillRound(user: UserEvent) {
  await user.type(box('Title'), 'Autumn 2026');
  await enter(user, 'Opening', '12 10 2026', '09:00');
  await enter(user, 'Closing', '2 11 2026', '17:00');
  await user.type(box('Budget'), '150000');
  await user.type(box('Smallest award'), '5000');
  await user.type(box('Largest award'), '25,000');
}

describe('adding a round', () => {
  const open = async () => {
    openConsole(`/northfield/programmes/${programme.id}/rounds/new`);
    await heading('New round');
    await screen.findByRole('textbox', { name: 'Title' });
  };

  it('asks for dates, times, a budget, an award range and what happens to late applications', async () => {
    stubApi({ ...manager(), ...reads });
    await open();

    await expectTitle(`New round – ${titleSuffix}`);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Community Spaces Fund' })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Opening date/ })).toBeTruthy();
    expect(screen.getByLabelText('Closing time').getAttribute('type')).toBe('time');
    expect(screen.getAllByText(/In your funder's time zone/)).toHaveLength(2);
    const late = screen.getByRole('group', { name: 'Late applications' });
    expect(
      within(late).getByRole<HTMLInputElement>('radio', { name: 'Refuse late applications' })
        .checked,
    ).toBe(true);
    expect(within(late).getByText('Applicants cannot submit after the closing time.')).toBeTruthy();
    expect(
      within(late).getByText(
        'Applicants can still submit, and you see which applications came in late.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add round' })).toBeTruthy();
  });

  it('sends the round as dates and times in pence, and opens it', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...manager(),
      ...reads,
      [api.createRound]: { status: 201, body: round },
    });
    await open();

    await fillRound(user);
    await user.click(
      screen.getByRole('radio', { name: 'Accept late applications and mark them as late' }),
    );
    await user.click(screen.getByRole('button', { name: 'Add round' }));

    await heading('Autumn 2026');
    expect(sent.find(({ key }) => key === api.createRound)?.body).toEqual({
      title: 'Autumn 2026',
      opensAt: '2026-10-12T09:00',
      closesAt: '2026-11-02T17:00',
      budget: pounds(150_000),
      awardMinimum: pounds(5_000),
      awardMaximum: pounds(25_000),
      latePolicy: 'accept_and_flag',
    });
    expect(window.location.pathname).toBe(`/northfield/rounds/${round.id}`);
  });

  it('says what is missing beside every box and in a summary, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...manager(), ...reads });
    await open();

    await user.click(screen.getByRole('button', { name: 'Add round' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Enter a title for the round.',
      'Enter the opening date as a day, month and year, like 12 10 2026.',
      'Enter the opening time.',
      'Enter the closing date as a day, month and year, like 12 10 2026.',
      'Enter the closing time.',
      'Enter the budget in pounds, like £150,000.',
      'Enter the smallest award in pounds, like £5,000.',
      'Enter the largest award in pounds, like £25,000.',
    ]);
    expect(box('Title').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Opening time').getAttribute('aria-invalid')).toBe('true');
    expect(box('Budget').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter the opening time.', { selector: 'p' })).toBeTruthy();
    expect(sent.map(({ key }) => key)).not.toContain(api.createRound);

    await user.click(within(summary).getByRole('link', { name: 'Enter the opening time.' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Opening time'));
  });

  it("shows the contract's checks between boxes beside the box to change", async () => {
    const user = userEvent.setup();
    stubApi({ ...manager(), ...reads });
    await open();
    await fillRound(user);
    await user.clear(box('Largest award'));
    await user.type(box('Largest award'), '200000');
    const closeDay = within(screen.getByRole('group', { name: /Closing date/ })).getByRole(
      'textbox',
      { name: 'Year' },
    );
    await user.clear(closeDay);
    await user.type(closeDay, '2025');

    await user.click(screen.getByRole('button', { name: 'Add round' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Enter a closing date and time after the opening date and time.',
      'Enter a budget the same as or more than the largest award.',
    ]);
  });

  it("shows the API's words when it refuses the round", async () => {
    const user = userEvent.setup();
    stubApi({
      ...manager(),
      ...reads,
      [api.createRound]: problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [
          {
            field: 'body.budget.amountMinor',
            message: 'Enter an amount of £1,000,000,000 or less.',
          },
        ],
      ),
    });
    await open();
    await fillRound(user);

    await user.click(screen.getByRole('button', { name: 'Add round' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').textContent).toBe(
      'Enter an amount of £1,000,000,000 or less.',
    );
    expect(box('Budget').getAttribute('aria-invalid')).toBe('true');
  });

  it('asks before leaving with entries that are not saved', async () => {
    const user = userEvent.setup();
    stubApi({ ...manager(), ...reads });
    await open();
    await user.type(box('Title'), 'Autumn');

    await user.click(screen.getByRole('link', { name: 'Cancel' }));

    expect(await screen.findByRole('dialog', { name: 'Leave this page?' })).toBeTruthy();
    expect(window.location.pathname).toBe(`/northfield/programmes/${programme.id}/rounds/new`);
  });
});

describe('a round page', () => {
  const open = async (more: Handlers = {}) => {
    stubApi({ ...manager(), ...reads, ...more });
    openConsole(`/northfield/rounds/${round.id}`);
    await heading('Autumn 2026');
  };

  it('shows the dates in the time zone they were entered in, the budget and the late policy', async () => {
    await open();

    await expectTitle(`Round – ${titleSuffix}`);
    expect(
      await screen.findByText(
        'Applications open on 12 October 2026 at 9am and close on 2 November 2026 at 5pm (Europe/London).',
      ),
    ).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(crumbs).getByRole('link', { name: 'Community Spaces Fund' }).getAttribute('href'),
    ).toBe(`/northfield/programmes/${programme.id}`);
    const details = screen.getByRole('tabpanel');
    expect(within(details).getByText('Opens').nextElementSibling?.textContent).toBe(
      '12 October 2026 at 9am',
    );
    expect(within(details).getByText('Time zone').nextElementSibling?.textContent).toBe(
      'Europe/London',
    );
    expect(within(details).getByText('Budget').nextElementSibling?.textContent).toBe('£150,000');
    expect(within(details).getByText('Smallest award').nextElementSibling?.textContent).toBe(
      '£5,000',
    );
    expect(within(details).getByText('Largest award').nextElementSibling?.textContent).toBe(
      '£25,000',
    );
    expect(within(details).getByText('Refuse late applications')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit round' }).getAttribute('href')).toBe(
      `/northfield/rounds/${round.id}/edit`,
    );
  });

  it('lists the stages with their rubrics and the way to edit each, from the keyboard', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('tab', { name: 'Stages and rubrics' }));

    const table = screen.getByRole('table', { name: 'Stages in this round' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      '1. IntakeNo rubricAdd rubric for Intake',
      '2. Review3 criteria, total weight 10Edit rubric for Review',
      '3. DecisionNo rubricAdd rubric for Decision',
    ]);
    expect(
      within(nth(rows, 1))
        .getByRole('link', { name: /^Edit rubric\s*for Review$/ })
        .getAttribute('href'),
    ).toBe(`/northfield/rounds/${round.id}/stages/${ids.review}/rubric`);
    expect(screen.getByRole('link', { name: 'Edit stages' }).getAttribute('href')).toBe(
      `/northfield/rounds/${round.id}/stages`,
    );
  });

  it('shows the history of the round with the stages and criteria named', async () => {
    const user = userEvent.setup();
    await open({
      [api.roundHistory]: ok({
        versions: [
          {
            version: 3,
            createdAt: '2026-10-14T09:00:00.000Z',
            author: { membershipId: ids.author, name: 'Ada Reed' },
            changes: [{ path: `stages.${ids.review}.criteria.${ids.need}.weight`, from: 3, to: 5 }],
          },
        ],
      }),
    });

    await user.click(screen.getByRole('tab', { name: 'History' }));
    const panel = await screen.findByRole('region', { name: 'Configuration history' });
    await user.click(await within(panel).findByText(/See what changed/));

    expect(within(panel).getByText('Changed criterion “Need”')).toBeTruthy();
    expect(within(panel).getByText('Criterion “Need” in stage “Review”: weight')).toBeTruthy();
    expect(within(panel).getByText('Before: 3')).toBeTruthy();
    expect(within(panel).getByText('After: 5')).toBeTruthy();
  });

  it('shows the words for a round that cannot be read', async () => {
    stubApi({ ...manager(), [api.round]: problem(404, 'We cannot find this round.') });
    openConsole(`/northfield/rounds/${round.id}`);

    expect(await screen.findByText('We cannot find this round.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Round' })).toBeTruthy();
  });
});

describe('changing a round', () => {
  const open = async (more: Handlers = {}) => {
    const sent = stubApi({ ...manager(), ...reads, ...more });
    openConsole(`/northfield/rounds/${round.id}/edit`);
    await heading('Edit round');
    await screen.findByDisplayValue('Autumn 2026');
    return sent;
  };

  it('shows the saved dates in three boxes and a time, and the time zone they are in', async () => {
    await open();

    const opening = screen.getByRole('group', { name: /Opening date/ });
    expect(within(opening).getByRole<HTMLInputElement>('textbox', { name: 'Day' }).value).toBe(
      '12',
    );
    expect(within(opening).getByRole<HTMLInputElement>('textbox', { name: 'Month' }).value).toBe(
      '10',
    );
    expect(within(opening).getByRole<HTMLInputElement>('textbox', { name: 'Year' }).value).toBe(
      '2026',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Opening time').value).toBe('09:00');
    expect(screen.getByLabelText<HTMLInputElement>('Closing time').value).toBe('17:00');
    expect(screen.getAllByText('In the Europe/London time zone')).toHaveLength(2);
    expect(box('Budget').value).toBe('150000');
    expect(box('Smallest award').value).toBe('5000');
    expect(box('Largest award').value).toBe('25000');
  });

  it('saves a change, says so, and asks about nothing when leaving', async () => {
    const user = userEvent.setup();
    const sent = await open({
      [api.updateRound]: (body) => ok({ ...round, ...(body as object) }),
    });

    await user.clear(box('Title'));
    await user.type(box('Title'), 'Autumn 2026 (extended)');
    await user.click(screen.getByRole('button', { name: 'Save round' }));

    expect(await screen.findByText('Round saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === api.updateRound)?.body).toEqual({
      title: 'Autumn 2026 (extended)',
      opensAt: '2026-10-12T09:00',
      closesAt: '2026-11-02T17:00',
      budget: pounds(150_000),
      awardMinimum: pounds(5_000),
      awardMaximum: pounds(25_000),
      latePolicy: 'refuse',
    });
    await user.click(screen.getByRole('link', { name: 'Back to round' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/northfield/rounds/${round.id}`);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
