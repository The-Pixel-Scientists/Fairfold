// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, ids, listReads, ok, page, summary } from './fixtures.ts';

setUpConsoleTests();

const PATH = '/northfield/submissions';

const submissions = [
  summary(1),
  summary(2),
  summary(3, { stage: { id: ids.review, name: 'Review' } }),
];

const box = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });
const bar = () => within(screen.getByRole('group', { name: 'Bulk actions' }));

describe('choosing submissions', () => {
  it('says how many are chosen, from a box, from all of the page, and from the keyboard', async () => {
    const user = userEvent.setup();
    stubApi(listReads(submissions));
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });
    expect(bar().getByText('Select submissions to act on several at once.')).toBeTruthy();
    expect(bar().getByRole<HTMLButtonElement>('button', { name: 'Move to stage' }).disabled).toBe(
      true,
    );

    await user.click(box('Select Harbourside Youth Project'));
    expect(bar().getByText('1 submission selected')).toBeTruthy();

    await user.click(box('Select all on this page'));
    expect(bar().getByText('3 submissions selected')).toBeTruthy();
    expect(box('Select all on this page').checked).toBe(true);

    await user.click(bar().getByRole('button', { name: 'Clear selection' }));
    expect(bar().getByText('Select submissions to act on several at once.')).toBeTruthy();
    expect(bar().queryByRole('button', { name: 'Clear selection' })).toBeNull();
    expect(box('Select Harbourside Youth Project').checked).toBe(false);
  });

  it('moves between rows with the arrow keys, chooses with Space and opens with Enter', async () => {
    const user = userEvent.setup();
    stubApi(listReads(submissions));
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });
    const rows = () => screen.getAllByRole('row').slice(1);
    rows()[0]?.focus();

    await user.keyboard('{ArrowDown} ');
    expect(document.activeElement).toBe(rows()[1]);
    expect(bar().getByText('1 submission selected')).toBeTruthy();
    expect(box('Select Millbrook Allotment Society').checked).toBe(true);

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(window.location.pathname).toBe(`${PATH}/${submissions[1]?.id ?? ''}`);
    });
  });

  it('lists the shortcuts in a dialog that opens from a button or from ? on a row, and returns focus', async () => {
    const user = userEvent.setup();
    stubApi(listReads(submissions));
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Open the submission')).toBeTruthy();
    expect(within(dialog).getByText('Select or deselect the submission')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    const row = screen.getAllByRole('row')[1] as HTMLElement;
    row.focus();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(row);
  });
});

describe('moving submissions to a stage', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>, names: string[]) {
    await screen.findByRole('table', { name: 'Submissions' });
    for (const name of names) await user.click(box(`Select ${name}`));
    await user.click(bar().getByRole('button', { name: 'Move to stage' }));
    return screen.getByRole('dialog', { name: 'Move to stage' });
  }

  it('confirms the stage and the count on the button, then reports what moved and reads the list again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    const sent = stubApi({
      ...listReads(submissions),
      [api.list()]: () => {
        reads += 1;
        return ok(
          page(
            reads === 1
              ? submissions
              : submissions.map((item) => ({ ...item, stage: { id: ids.review, name: 'Review' } })),
          ),
        );
      },
      [api.move(ids.review)]: ok({ moved: 2 }),
    });
    openConsole(PATH);
    const dialog = await openDialog(user, [
      'Harbourside Youth Project',
      'Millbrook Allotment Society',
      'Northfield Lunch Club',
    ]);
    expect(within(dialog).getByText(/Choose the stage to move 3 submissions to/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Move to stage' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Stage' }), 'Review');
    expect(
      within(dialog).getByText('1 submission already in Review will stay there.'),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Move 3 submissions to Review' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const notice = screen.getByText(/moved to Review/);
    expect(notice.textContent).toBe(
      '2 submissions moved to Review. 1 submission already in Review stayed there.',
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(notice);
    });
    expect(sent.find(({ key }) => key === api.move(ids.review))?.body).toEqual({
      submissionIds: submissions.map(({ id }) => id),
    });
    expect(bar().getByText('Select submissions to act on several at once.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText('Review')).toHaveLength(3);
    });
  });

  it('names each submission the API refused and why, moves none, and offers to remove them', async () => {
    const user = userEvent.setup();
    stubApi({
      ...listReads(submissions),
      [api.move(ids.review)]: problem(
        409,
        'No submissions were moved. Remove the ones listed and try again.',
        [
          {
            field: 'body.submissionIds.1',
            message: 'This submission was withdrawn, so it cannot move. Remove it and try again.',
          },
        ],
      ),
    });
    openConsole(PATH);
    const dialog = await openDialog(user, [
      'Harbourside Youth Project',
      'Millbrook Allotment Society',
    ]);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Stage' }), 'Review');

    await user.click(within(dialog).getByRole('button', { name: 'Move 2 submissions to Review' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('No submissions were moved.');
    expect(within(alert).getByText('Millbrook Allotment Society.')).toBeTruthy();
    expect(alert.textContent).toContain('This submission was withdrawn, so it cannot move.');
    expect(within(alert).queryByText('Harbourside Youth Project.')).toBeNull();

    await user.click(
      within(alert).getByRole('button', { name: 'Remove these from the selection' }),
    );
    expect(bar().getByText('1 submission selected')).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: 'Move 1 submission to Review' }),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('says what went wrong when the move fails for any other reason, and keeps the choice', async () => {
    const user = userEvent.setup();
    stubApi({
      ...listReads(submissions),
      [api.move(ids.review)]: problem(503, 'The service is busy. Try again in a minute.'),
    });
    openConsole(PATH);
    const dialog = await openDialog(user, ['Harbourside Youth Project']);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Stage' }), 'Review');

    await user.click(within(dialog).getByRole('button', { name: 'Move 1 submission to Review' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The service is busy. Try again in a minute.',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Stage' })).toHaveProperty(
      'value',
      ids.review,
    );
  });

  it('cancels without moving anything', async () => {
    const user = userEvent.setup();
    const sent = stubApi(listReads(submissions));
    openConsole(PATH);
    const dialog = await openDialog(user, ['Harbourside Youth Project']);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.some(({ key }) => key.startsWith('POST'))).toBe(false);
    expect(bar().getByText('1 submission selected')).toBeTruthy();
  });

  it('does not offer a stage when the chosen submissions are in different rounds', async () => {
    const user = userEvent.setup();
    const elsewhere = summary(2, {
      round: { id: '99999999-8888-4777-8666-555555555555', title: 'Spring 2027' },
    });
    stubApi(listReads([summary(1), elsewhere]));
    openConsole(PATH);

    const dialog = await openDialog(user, [
      'Harbourside Youth Project',
      'Millbrook Allotment Society',
    ]);

    expect(within(dialog).getByText(/in different rounds/)).toBeTruthy();
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows why the stages did not load and lets the person try again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...listReads(submissions),
      [api.stages]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok({ stages: [{ id: ids.review, name: 'Review', position: 2, criteria: [] }] });
      },
    });
    openConsole(PATH);
    await screen.findByRole('table', { name: 'Submissions' });
    await user.click(box('Select Harbourside Youth Project'));
    await user.click(bar().getByRole('button', { name: 'Move to stage' }));
    const dialog = screen.getByRole('dialog', { name: 'Move to stage' });

    await user.click(await within(dialog).findByRole('button', { name: 'Try again' }));

    expect(await within(dialog).findByRole('combobox', { name: 'Stage' })).toBeTruthy();
  });
});
