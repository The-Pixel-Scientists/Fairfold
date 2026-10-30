// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, decision, heading, ids, list, ok, pageReads, row, rows } from './fixtures.ts';

setUpConsoleTests();

const PATH = `/northfield/rounds/${ids.round}/decisions`;
const TABLE = 'Submissions and their decisions';

const bodyRows = () =>
  within(screen.getByRole('table', { name: TABLE }))
    .getAllByRole('row')
    .slice(1);
const names = () =>
  bodyRows().map(
    (line) => within(within(line).getByRole('rowheader')).getByRole('link').textContent,
  );

describe('the decisions of a round', () => {
  it('shows each submission with its score, outcome, amount and whether it is released', async () => {
    stubApi(
      pageReads(
        list([
          row(1, {
            decision: decision('accepted', { releasedAt: '2026-11-25T09:00:00.000Z' }),
            email: 'sent',
          }),
          row(2, { decision: decision('waitlisted') }),
          row(3, { decision: decision('declined') }),
          row(4),
          row(5, { meanScore: null, reviews: 0 }),
        ]),
      ),
    );
    openConsole(PATH);

    expect(await heading('Decisions')).toBeTruthy();
    await screen.findByRole('table', { name: TABLE });
    const [first, second, third, fourth, fifth] = bodyRows() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(first.textContent).toContain('Harbourside Youth Project');
    expect(first.textContent).toContain('4.20');
    expect(first.textContent).toContain('2 reviews');
    expect(within(first).getByText('Accepted')).toBeTruthy();
    expect(first.textContent).toContain('£12,500');
    expect(within(first).getByText('Released')).toBeTruthy();
    expect(first.textContent).toContain('Email: sent');
    expect(within(first).queryByRole('button', { name: /Change decision/ })).toBeNull();
    expect(within(second).getByText('Waitlisted')).toBeTruthy();
    expect(within(second).getByText('Not released')).toBeTruthy();
    expect(within(third).getByText('Declined')).toBeTruthy();
    expect(within(fourth).getByText('No decision yet')).toBeTruthy();
    expect(within(fifth).getByText('No reviews yet')).toBeTruthy();
    expect(within(fifth).getByText('No amount')).toBeTruthy();
    const breadcrumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumbs).getByText('Community Spaces Fund')).toBeTruthy();
  });

  it('says plainly that applicants see nothing until decisions are released', async () => {
    stubApi(pageReads());
    openConsole(PATH);

    expect(
      await screen.findByText('Applicants see nothing until you release decisions'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Release decisions' }).getAttribute('href')).toBe(
      `/northfield/rounds/${ids.round}/decisions/release`,
    );
  });

  it('adds up the awards against the budget, in words', async () => {
    stubApi(pageReads());
    openConsole(PATH);

    const meter = await screen.findByRole('meter', { name: 'Awarded against budget' });
    expect(meter.getAttribute('aria-valuetext')).toBe('£12,500 of £150,000, £137,500 left');
    const summary = screen.getByRole('group', { name: 'Decision summary' });
    expect(summary.textContent).toContain('Awarded£12,500to 1 submission');
    expect(summary.textContent).toContain('Decided3 of 5');
    expect(screen.queryByText("The awards are over the round's budget")).toBeNull();
  });

  it('shows going over the budget in words, and does not refuse it', async () => {
    const big = (n: number) => row(n, { decision: decision('accepted', {}, 90_000) });
    stubApi(pageReads(list([big(1), big(2)])));
    openConsole(PATH);

    const meter = await screen.findByRole('meter', { name: 'Awarded against budget' });
    expect(meter.getAttribute('aria-valuetext')).toBe('£180,000 of £150,000, £30,000 over budget');
    expect(screen.getByText("The awards are over the round's budget")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Release decisions' })).toBeTruthy();
  });

  it('filters by outcome with counts, and sorts by a column', async () => {
    const user = userEvent.setup();
    stubApi(pageReads());
    openConsole(PATH);
    await screen.findByRole('table', { name: TABLE });

    expect(screen.getByRole('button', { name: /^No decision/ }).textContent).toContain('2');
    await user.click(screen.getByRole('button', { name: /^No decision/ }));
    expect(names()).toEqual(['Riverside Repair Cafe', 'Eastgate Music Trust']);
    expect(screen.getByRole('button', { name: /^No decision/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await user.click(screen.getByRole('button', { name: /^All/ }));
    await user.click(screen.getByRole('button', { name: 'Mean score' }));
    await user.click(screen.getByRole('button', { name: 'Mean score' }));
    expect(names()[0]).toBe('Harbourside Youth Project');
    await user.click(screen.getByRole('button', { name: 'Organisation' }));
    expect(names()[0]).toBe('Eastgate Music Trust');
  });

  it('explains an outcome nobody has yet', async () => {
    const user = userEvent.setup();
    stubApi(pageReads(list([row(1), row(2)])));
    openConsole(PATH);
    await screen.findByRole('table', { name: TABLE });

    await user.click(screen.getByRole('button', { name: /^Accepted/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'No submissions here' })).toBeTruthy();
  });

  it('lists the keys, and opens the decision from Enter on a row', async () => {
    const user = userEvent.setup();
    stubApi(pageReads());
    openConsole(PATH);
    await screen.findByRole('table', { name: TABLE });

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    await user.keyboard('{Escape}');
    bodyRows()[3]?.focus();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Record decision' })).toBeTruthy();
  });

  it('tells a manager with no submissions what to do next', async () => {
    stubApi(pageReads(list([])));
    openConsole(PATH);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No submissions to decide yet' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to submissions' }).getAttribute('href')).toBe(
      `/northfield/submissions?roundId=${ids.round}`,
    );
  });

  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...pageReads(),
      [api.list]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok(list(rows));
      },
    });
    openConsole(PATH);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: TABLE })).toBeTruthy();
  });

  it('is for someone who can record decisions, and never for a reviewer', async () => {
    stubApi({ 'GET /auth/session': ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole(PATH);

    expect(await heading('Decisions')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'You cannot record decisions' }),
    ).toBeTruthy();
  });

  it('offers to send emails that did not go', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...pageReads(list(rows, { unsentEmails: 2 })),
      [api.send]: ok({ sent: 2, failed: 0, pending: 0 }),
    });
    openConsole(PATH);

    expect(await screen.findByText('2 decision emails not sent')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send unsent emails' }));

    expect(await screen.findByText('2 emails sent. 0 waiting to send.')).toBeTruthy();
    expect(sent.filter(({ key }) => key === api.send)).toHaveLength(1);
  });

  it('asks the person to confirm it is them when sending needs a recent sign-in', async () => {
    const user = userEvent.setup();
    let tries = 0;
    const sent = stubApi({
      ...pageReads(list(rows, { unsentEmails: 1 })),
      [api.send]: () => {
        tries += 1;
        return tries === 1
          ? problem(403, 'Confirm it is you again, then try again.')
          : ok({ sent: 1, failed: 0, pending: 0 });
      },
      [api.stepUp]: ok(consoleSession()),
    });
    openConsole(PATH);

    await user.click(await screen.findByRole('button', { name: 'Send unsent emails' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(dialog).getByLabelText('Password'), 'correct horse battery');
    await user.type(within(dialog).getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm it is you' }));

    expect(await screen.findByText('1 email sent. 0 waiting to send.')).toBeTruthy();
    expect(sent.filter(({ key }) => key === api.stepUp)).toHaveLength(1);
  });
});
