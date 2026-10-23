// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { joined } from '../testing/names.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, decision, ids, list, ok, pageReads, row, rows } from './fixtures.ts';

setUpConsoleTests();

const PATH = `/northfield/rounds/${ids.round}/decisions`;
const TABLE = 'Submissions and their decisions';
const cafe = row(4);
const music = row(5);

async function openPage() {
  openConsole(PATH);
  await screen.findByRole('table', { name: TABLE });
}

/** A row's button, named by what it does and for whom: the visible words, then the hidden ones. */
const action = (verb: string, organisation: string) => joined(verb, `for ${organisation}`);

const award = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' });

describe('recording one decision', () => {
  it('records an award privately with the amount in pounds, and says so', async () => {
    const user = userEvent.setup();
    let held = list(rows);
    const sent = stubApi({
      ...pageReads(),
      [api.list]: () => ok(held),
      [api.record(cafe.submissionId)]: (body) => {
        held = list(
          rows.map((item) =>
            item.submissionId === cafe.submissionId
              ? row(4, { decision: decision('accepted', {}, 12_500) })
              : item,
          ),
        );
        return ok({
          ...(body as object),
          recordedAt: '2026-11-20T10:00:00.000Z',
          releasedAt: null,
        });
      },
    });
    await openPage();

    const opener = screen.getByRole('button', {
      name: action('Record decision', 'Riverside Repair Cafe'),
    });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Record decision' });
    expect(dialog.textContent).toContain('For Riverside Repair Cafe.');
    expect(within(dialog).queryByLabelText('Amount to award')).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: /^Accepted/ }));
    expect(within(dialog).getByText('Between £5,000 and £25,000, in pounds.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Amount to award'), '12,500');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));

    const message = await screen.findByText(
      'Decision recorded for Riverside Repair Cafe. Only staff can see it.',
    );
    expect(message.closest('[role="status"]')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
    expect(sent.find(({ key }) => key === api.record(cafe.submissionId))?.body).toEqual({
      outcome: 'accepted',
      amount: award(12_500),
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const line = screen.getByRole('row', { name: /Riverside Repair Cafe/ });
    expect(line.textContent).toContain('£12,500');
    expect(line.textContent).toContain('Not released');
  });

  it('records a waitlisting or a decline with no amount', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...pageReads(),
      [api.record(cafe.submissionId)]: ok(decision('waitlisted')),
    });
    await openPage();

    await user.click(
      screen.getByRole('button', { name: action('Record decision', 'Riverside Repair Cafe') }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Record decision' });
    await user.click(within(dialog).getByRole('radio', { name: 'Waitlisted' }));
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));

    await waitFor(() => {
      expect(sent.find(({ key }) => key === api.record(cafe.submissionId))?.body).toEqual({
        outcome: 'waitlisted',
      });
    });
  });

  it('starts from the decision already recorded, and names the change', async () => {
    const user = userEvent.setup();
    stubApi(pageReads());
    await openPage();

    await user.click(
      screen.getByRole('button', { name: action('Change decision', 'Harbourside Youth Project') }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Change decision' });
    expect(within(dialog).getByRole('radio', { name: /^Accepted/ })).toHaveProperty(
      'checked',
      true,
    );
    expect(within(dialog).getByLabelText('Amount to award')).toHaveProperty('value', '12500');
  });

  it('says what to fix before sending anything', async () => {
    const user = userEvent.setup();
    const sent = stubApi(pageReads());
    await openPage();

    await user.click(
      screen.getByRole('button', { name: action('Record decision', 'Riverside Repair Cafe') }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Record decision' });
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    expect(within(dialog).getAllByText('Choose an outcome.').length).toBeGreaterThan(0);

    await user.click(within(dialog).getByRole('radio', { name: /^Accepted/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    expect(
      within(dialog).getAllByText('Enter the amount to award, in pounds.').length,
    ).toBeGreaterThan(0);

    await user.type(within(dialog).getByLabelText('Amount to award'), '30000');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    expect(
      within(dialog).getAllByText('Enter an amount between £5,000 and £25,000.').length,
    ).toBeGreaterThan(0);

    await user.clear(within(dialog).getByLabelText('Amount to award'));
    await user.type(within(dialog).getByLabelText('Amount to award'), 'lots');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    expect(
      within(dialog).getAllByText('Enter the amount in pounds, such as 12,500.').length,
    ).toBeGreaterThan(0);
    expect(sent.filter(({ key }) => key.startsWith('PUT'))).toEqual([]);
  });

  it('shows what the server refused, and keeps the dialog open', async () => {
    const user = userEvent.setup();
    stubApi({
      ...pageReads(),
      [api.record(cafe.submissionId)]: problem(
        409,
        'This decision has been released, so it can no longer change.',
      ),
    });
    await openPage();

    await user.click(
      screen.getByRole('button', { name: action('Record decision', 'Riverside Repair Cafe') }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Record decision' });
    await user.click(within(dialog).getByRole('radio', { name: 'Declined' }));
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));

    expect(
      await within(dialog).findByText(
        'This decision has been released, so it can no longer change.',
      ),
    ).toBeTruthy();
  });

  it('returns focus to the button that opened it when cancelled', async () => {
    const user = userEvent.setup();
    stubApi(pageReads());
    await openPage();

    const opener = screen.getByRole('button', {
      name: action('Record decision', 'Riverside Repair Cafe'),
    });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });
});

describe('recording decisions for several submissions', () => {
  const choose = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('checkbox', { name: 'Select Riverside Repair Cafe' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Eastgate Music Trust' }));
    const bar = screen.getByRole('group', { name: 'Bulk actions' });
    expect(bar.textContent).toContain('2 submissions selected');
    await user.click(within(bar).getByRole('button', { name: 'Record decisions' }));
    return screen.findByRole('dialog', { name: 'Record decisions' });
  };

  it('records one outcome with an amount for each award, all at once', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...pageReads(), [api.recordMany]: ok({ recorded: 2 }) });
    await openPage();

    const dialog = await choose(user);
    await user.click(within(dialog).getByRole('radio', { name: /^Accepted/ }));
    await user.type(within(dialog).getByLabelText('Riverside Repair Cafe'), '10000');
    await user.type(within(dialog).getByLabelText('Eastgate Music Trust'), '7,500.50');
    await user.click(within(dialog).getByRole('button', { name: 'Record 2 decisions' }));

    const message = await screen.findByText('2 decisions recorded. Only staff can see them.');
    await waitFor(() => {
      expect(document.activeElement).toBe(message.closest('[role="status"]'));
    });
    expect(sent.find(({ key }) => key === api.recordMany)?.body).toEqual({
      decisions: [
        {
          submissionId: cafe.submissionId,
          decision: { outcome: 'accepted', amount: award(10_000) },
        },
        {
          submissionId: music.submissionId,
          decision: { outcome: 'accepted', amount: { amountMinor: 750_050, currency: 'GBP' } },
        },
      ],
    });
    expect(screen.getByRole('group', { name: 'Bulk actions' }).textContent).toContain(
      'Select submissions to act on several at once.',
    );
  });

  it('declines several with no amounts', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...pageReads(), [api.recordMany]: ok({ recorded: 2 }) });
    await openPage();

    const dialog = await choose(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Declined' }));
    expect(within(dialog).queryByText('Amount to award to each')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Record 2 decisions' }));

    await waitFor(() => {
      expect(sent.find(({ key }) => key === api.recordMany)?.body).toMatchObject({
        decisions: [{ decision: { outcome: 'declined' } }, { decision: { outcome: 'declined' } }],
      });
    });
  });

  it('names each award that is missing or outside the range, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = stubApi(pageReads());
    await openPage();

    const dialog = await choose(user);
    await user.click(within(dialog).getByRole('button', { name: 'Record 2 decisions' }));
    expect(within(dialog).getAllByText('Choose an outcome.').length).toBeGreaterThan(0);

    await user.click(within(dialog).getByRole('radio', { name: /^Accepted/ }));
    await user.type(within(dialog).getByLabelText('Riverside Repair Cafe'), '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Record 2 decisions' }));
    const summary = within(dialog).getByRole('alert');
    expect(summary.textContent).toContain(
      'Riverside Repair Cafe: Enter an amount between £5,000 and £25,000.',
    );
    expect(summary.textContent).toContain(
      'Eastgate Music Trust: Enter the amount to award, in pounds.',
    );
    expect(sent.filter(({ key }) => key.startsWith('POST'))).toEqual([]);
  });

  it('puts the server’s refusal beside the award it names', async () => {
    const user = userEvent.setup();
    stubApi({
      ...pageReads(),
      [api.recordMany]: problem(400, 'Fix the fields listed and try again.', [
        {
          field: 'body.decisions.1.decision.amount',
          message: 'Enter an amount between £5,000 and £25,000.',
        },
      ]),
    });
    await openPage();

    const dialog = await choose(user);
    await user.click(within(dialog).getByRole('radio', { name: /^Accepted/ }));
    await user.type(within(dialog).getByLabelText('Riverside Repair Cafe'), '10000');
    await user.type(within(dialog).getByLabelText('Eastgate Music Trust'), '10000');
    await user.click(within(dialog).getByRole('button', { name: 'Record 2 decisions' }));

    const field = within(dialog).getByLabelText('Eastgate Music Trust');
    await waitFor(() => {
      expect(field.getAttribute('aria-invalid')).toBe('true');
    });
    expect(
      within(dialog).getByLabelText('Riverside Repair Cafe').getAttribute('aria-invalid'),
    ).toBe(null);
  });

  it('leaves released decisions as they are', async () => {
    const user = userEvent.setup();
    const released = row(4, {
      decision: decision('declined', { releasedAt: '2026-11-25T09:00:00.000Z' }),
    });
    const sent = stubApi({
      ...pageReads(list([rows[0] ?? cafe, released, music])),
      [api.recordMany]: ok({ recorded: 1 }),
    });
    await openPage();

    await user.click(screen.getByRole('checkbox', { name: 'Select Riverside Repair Cafe' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Eastgate Music Trust' }));
    await user.click(screen.getByRole('button', { name: 'Record decisions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record decisions' });
    expect(dialog.textContent).toContain('One chosen decision is already released');
    await user.click(within(dialog).getByRole('radio', { name: 'Waitlisted' }));
    await user.click(within(dialog).getByRole('button', { name: 'Record 1 decision' }));

    await waitFor(() => {
      expect(sent.find(({ key }) => key === api.recordMany)?.body).toEqual({
        decisions: [{ submissionId: music.submissionId, decision: { outcome: 'waitlisted' } }],
      });
    });
  });
});

describe('previewing the email', () => {
  it('shows the subject and body the applicant will get, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...pageReads(),
      [api.email(rows[0]?.submissionId ?? '')]: ok({
        subject: 'Community Spaces Fund: we are offering you a grant',
        body: 'Dear Sam,\n\nWe are pleased to offer you £12,500.',
      }),
    });
    await openPage();

    const opener = screen.getByRole('button', {
      name: action('Preview email', 'Harbourside Youth Project'),
    });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', {
      name: 'Email for Harbourside Youth Project',
    });
    expect(
      await within(dialog).findByText('Dear Sam, We are pleased to offer you £12,500.', {
        normalizer: (text) => text.replace(/\s+/g, ' ').trim(),
      }),
    ).toBeTruthy();
    expect(dialog.textContent).toContain('Community Spaces Fund: we are offering you a grant');
    expect(dialog.textContent).toContain('Nothing is sent now.');
    expect(sent.some(({ key }) => key.startsWith('POST'))).toBe(false);

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it('says why the email could not be shown', async () => {
    const user = userEvent.setup();
    stubApi({
      ...pageReads(),
      [api.email(rows[0]?.submissionId ?? '')]: problem(
        409,
        'This template has changed. Open the outcome emails and save it again.',
      ),
    });
    await openPage();

    await user.click(
      screen.getByRole('button', { name: action('Preview email', 'Harbourside Youth Project') }),
    );
    expect(
      await screen.findByText(
        'This template has changed. Open the outcome emails and save it again.',
      ),
    ).toBeTruthy();
  });
});
