// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, decision, heading, ids, list, ok, pageReads, row, rows } from './fixtures.ts';

setUpConsoleTests();

const PATH = `/northfield/rounds/${ids.round}/decisions/release`;
const [awarded, waitlisted, declined] = rows;

const emails = {
  [api.email(awarded?.submissionId ?? '')]: ok({
    subject: 'Community Spaces Fund: we are offering you a grant',
    body: 'Dear Sam,\n\nWe are pleased to offer you £12,500.',
  }),
  [api.email(waitlisted?.submissionId ?? '')]: ok({
    subject: 'Community Spaces Fund: your application',
    body: 'You are on the waiting list.',
  }),
  [api.email(declined?.submissionId ?? '')]: ok({
    subject: 'Community Spaces Fund: your application',
    body: 'We could not fund your project this time.',
  }),
};

const reads = (found = list(rows), more = {}) => ({ ...pageReads(found), ...emails, ...more });

const delivered = { released: 3, sent: 3, failed: 0, pending: 0 };

async function confirmItsYou(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await user.type(within(dialog).getByLabelText('Password'), 'correct horse battery');
  await user.type(within(dialog).getByLabelText(/Code from your authenticator app/), '123456');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm it is you' }));
  return dialog;
}

describe('releasing the decisions of a round', () => {
  it('summarises how many of each outcome go, that emails go now, and shows an email', async () => {
    stubApi(reads());
    openConsole(PATH);

    expect(await heading('Release decisions')).toBeTruthy();
    const summary = await screen.findByRole('group', { name: 'Decisions to release' });
    expect(summary.textContent).toContain('Awarded£12,500to 1 applicant');
    expect(summary.textContent).toContain('Waitlisted1');
    expect(summary.textContent).toContain('Declined1');
    expect(summary.textContent).toContain('Emails3sent now, one to each applicant');
    expect(screen.getByText('Straight after you confirm')).toBeTruthy();
    expect(
      screen.getByText('2 submissions with no decision. Their applicants are told nothing now.'),
    ).toBeTruthy();
    expect(screen.getByText(/All awards: £12,500 of £150,000, £137,500 left/)).toBeTruthy();

    const select = screen.getByRole('combobox', { name: /Preview the email for/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Accepted: Harbourside Youth Project',
      'Waitlisted: Millbrook Allotment Society',
      'Declined: Northfield Lunch Club',
    ]);
    expect(
      await screen.findByText('Community Spaces Fund: we are offering you a grant'),
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(select, 'Declined: Northfield Lunch Club');
    expect(await screen.findByText('We could not fund your project this time.')).toBeTruthy();
  });

  it('shows an award over the budget in words', async () => {
    const big = (n: number) => row(n, { decision: decision('accepted', {}, 90_000) });
    stubApi({
      ...pageReads(list([big(1), big(2)])),
      [api.email(big(1).submissionId)]: ok({ subject: 'Award', body: 'Well done.' }),
    });
    openConsole(PATH);

    expect(await screen.findByText(/£180,000 of £150,000, £30,000 over budget/)).toBeTruthy();
  });

  it('asks for the box to be ticked before it asks who is releasing', async () => {
    const user = userEvent.setup();
    const sent = stubApi(reads());
    openConsole(PATH);

    await user.click(await screen.findByRole('button', { name: 'Release decisions' }));
    expect(
      screen.getAllByText('Tick the box to confirm you have checked the summary and the email.')
        .length,
    ).toBeGreaterThan(0);
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: /I have checked/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.some(({ key }) => key.startsWith('POST'))).toBe(false);
  });

  it('releases after the person confirms it is them, and says how many emails went', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads(list(rows), {
        [api.stepUp]: ok(consoleSession()),
        [api.release]: ok(delivered),
      }),
    );
    openConsole(PATH);

    await user.click(await screen.findByRole('checkbox', { name: /I have checked the summary/ }));
    await user.click(screen.getByRole('button', { name: 'Release decisions' }));
    await confirmItsYou(user);

    const message = await screen.findByText(
      '3 decisions released. 3 emails sent. 0 waiting to send.',
    );
    expect(screen.getByText('Decisions released')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(message.closest('[role="status"]'));
    });
    const posts = sent.filter(({ key }) => key.startsWith('POST')).map(({ key }) => key);
    expect(posts).toEqual([api.stepUp, api.release]);
    expect(sent.find(({ key }) => key === api.release)?.body).toEqual({
      release: 'chosen',
      submissionIds: rows.slice(0, 3).map((item) => item.submissionId),
    });
    expect(screen.queryByRole('button', { name: 'Release decisions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to decisions' }).getAttribute('href')).toBe(
      `/northfield/rounds/${ids.round}/decisions`,
    );
    expect(screen.queryByRole('button', { name: 'Send unsent emails' })).toBeNull();
  });

  it('offers to send the emails that are waiting or did not go', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads(list(rows), {
        [api.stepUp]: ok(consoleSession()),
        [api.release]: ok({ released: 3, sent: 0, failed: 1, pending: 2 }),
        [api.send]: ok({ sent: 3, failed: 0, pending: 0 }),
      }),
    );
    openConsole(PATH);

    await user.click(await screen.findByRole('checkbox', { name: /I have checked the summary/ }));
    await user.click(screen.getByRole('button', { name: 'Release decisions' }));
    await confirmItsYou(user);

    expect(
      await screen.findByText(
        '3 decisions released. 0 emails sent. 2 waiting to send. 1 could not be sent.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('3 decision emails not sent')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send unsent emails' }));

    expect(await screen.findByText('3 emails sent. 0 waiting to send.')).toBeTruthy();
    expect(screen.getByText('Emails sent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send unsent emails' })).toBeNull();
    expect(sent.filter(({ key }) => key === api.stepUp)).toHaveLength(1);
  });

  it('releases nothing when the password or code is not right', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads(list(rows), { [api.stepUp]: problem(401, 'The code was already used.') }),
    );
    openConsole(PATH);

    await user.click(await screen.findByRole('checkbox', { name: /I have checked the summary/ }));
    await user.click(screen.getByRole('button', { name: 'Release decisions' }));
    const dialog = await confirmItsYou(user);

    expect(
      await within(dialog).findByText(
        'Your password or code is not right. Check them and try again.',
      ),
    ).toBeTruthy();
    expect(sent.some(({ key }) => key === api.release)).toBe(false);
  });

  it('releases nothing when the person cancels the check', async () => {
    const user = userEvent.setup();
    const sent = stubApi(reads());
    openConsole(PATH);

    await user.click(await screen.findByRole('checkbox', { name: /I have checked the summary/ }));
    await user.click(screen.getByRole('button', { name: 'Release decisions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(sent.some(({ key }) => key.startsWith('POST'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Release decisions' })).toBeTruthy();
  });

  it('says what the server refused and leaves the page as it was', async () => {
    const user = userEvent.setup();
    stubApi(
      reads(list(rows), {
        [api.stepUp]: ok(consoleSession()),
        [api.release]: problem(409, 'There are no recorded decisions to release.'),
      }),
    );
    openConsole(PATH);

    await user.click(await screen.findByRole('checkbox', { name: /I have checked the summary/ }));
    await user.click(screen.getByRole('button', { name: 'Release decisions' }));
    await confirmItsYou(user);

    expect(await screen.findByText('There are no recorded decisions to release.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Release decisions' })).toBeTruthy();
  });

  it('tells a manager with nothing to release what to do next', async () => {
    const released = row(1, {
      decision: decision('accepted', { releasedAt: '2026-11-25T09:00:00.000Z' }),
      email: 'sent',
    });
    stubApi(pageReads(list([released, row(2)])));
    openConsole(PATH);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No decisions to release' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to decisions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Release decisions' })).toBeNull();
  });

  it('still offers to send emails when every decision is already released', async () => {
    const released = row(1, {
      decision: decision('accepted', { releasedAt: '2026-11-25T09:00:00.000Z' }),
      email: 'failed',
    });
    stubApi(pageReads(list([released], { unsentEmails: 1 })));
    openConsole(PATH);

    expect(await screen.findByText('1 decision email not sent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send unsent emails' })).toBeTruthy();
  });

  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let tries = 0;
    stubApi(
      reads(list(rows), {
        [api.list]: () => {
          tries += 1;
          return tries === 1
            ? problem(503, 'The service is busy. Try again in a minute.')
            : ok(list(rows));
        },
      }),
    );
    openConsole(PATH);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('group', { name: 'Decisions to release' })).toBeTruthy();
  });

  it('is for someone who can release decisions, and never for a reviewer', async () => {
    stubApi({ 'GET /auth/session': ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole(PATH);

    expect(await heading('Release decisions')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'You cannot release decisions' }),
    ).toBeTruthy();
  });
});
