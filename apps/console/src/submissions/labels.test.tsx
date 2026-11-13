// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { listReads, ok, summary, uuid } from './fixtures.ts';

setUpConsoleTests();

const LABELS = 'GET /console/labels';
const BULK = 'POST /console/submission-labels';
const CREATE = 'POST /console/labels';

const urgent = { id: uuid(901), name: 'Needs a call', colour: 'warning', archived: false };
const old = { id: uuid(902), name: 'Pilot cohort', colour: null, archived: true };
const submissions = [summary(1), summary(2), summary(3)];

const box = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });
const bar = () => within(screen.getByRole('group', { name: 'Bulk actions' }));

async function openList(more = {}, rows = submissions) {
  const sent = stubApi({
    ...listReads(rows),
    [LABELS]: ok({ labels: [urgent, old] }),
    ...more,
  });
  openConsole('/northfield/submissions');
  await screen.findByRole('table', { name: 'Submissions' });
  return sent;
}

describe('labels on chosen submissions', () => {
  it('adds a label to every chosen submission in one request and says how many changed', async () => {
    const user = userEvent.setup();
    const sent = await openList({ [BULK]: ok({ changed: 2 }) });
    await user.click(box('Select Harbourside Youth Project'));
    await user.click(box('Select Millbrook Allotment Society'));

    await user.click(bar().getByRole('button', { name: 'Add labels' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add labels' });
    expect(await within(dialog).findByRole('checkbox', { name: 'Needs a call' })).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox', { name: /Pilot cohort/ })).toBeNull();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Needs a call' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add labels' }));

    expect(await screen.findByText('Labels added to 2 submissions.')).toBeTruthy();
    expect(sent.find(({ key }) => key === BULK)?.body).toEqual({
      submissionIds: [uuid(101), uuid(102)],
      add: [urgent.id],
      remove: [],
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers an archived label for removal only, marked as archived', async () => {
    const user = userEvent.setup();
    const sent = await openList({ [BULK]: ok({ changed: 1 }) });
    await user.click(box('Select Harbourside Youth Project'));

    await user.click(bar().getByRole('button', { name: 'Remove labels' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove labels' });
    await user.click(
      await within(dialog).findByRole('checkbox', { name: 'Pilot cohort (archived)' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove labels' }));

    await waitFor(() => {
      expect(sent.find(({ key }) => key === BULK)?.body).toEqual({
        submissionIds: [uuid(101)],
        add: [],
        remove: [old.id],
      });
    });
  });

  it('asks for a label before sending anything', async () => {
    const user = userEvent.setup();
    const sent = await openList();
    await user.click(box('Select Harbourside Youth Project'));
    await user.click(bar().getByRole('button', { name: 'Add labels' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add labels' });
    await within(dialog).findByRole('checkbox', { name: 'Needs a call' });

    await user.click(within(dialog).getByRole('button', { name: 'Add labels' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Choose a label to add or remove.',
    );
    expect(sent.some(({ key }) => key === BULK)).toBe(false);
  });

  it('keeps the dialog and the selection when the server refuses, saying what to do', async () => {
    const user = userEvent.setup();
    await openList({
      [BULK]: problem(400, 'One of the labels is archived. Choose labels that are in use.'),
    });
    await user.click(box('Select Harbourside Youth Project'));
    await user.click(bar().getByRole('button', { name: 'Add labels' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add labels' });
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Needs a call' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add labels' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'One of the labels is archived. Choose labels that are in use.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(bar().getByText('1 submission selected')).toBeTruthy();
  });

  it('refuses a selection over the cap before sending, and says how many to deselect', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 201 }, (_, index) => summary(index + 1));
    const sent = await openList({}, many);
    await user.click(box('Select all on this page'));

    await user.click(bar().getByRole('button', { name: 'Add labels' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add labels' });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'A change takes at most 200 submissions. Deselect 1 submission to continue.',
    );
    expect(sent.some(({ key }) => key === BULK || key === LABELS)).toBe(false);
  });
});

describe('the label set manager', () => {
  async function openManager(more = {}) {
    const sent = stubApi({
      ...listReads([]),
      [LABELS]: ok({ labels: [urgent, old] }),
      ...more,
    });
    openConsole('/northfield/labels');
    await screen.findByRole('heading', { level: 1, name: 'Labels' });
    return sent;
  }

  it('lists labels by name, marks archived ones and has no delete control', async () => {
    await openManager();

    const table = await screen.findByRole('table', { name: 'Labels' });
    expect(within(table).getByText('Needs a call', { selector: 'span' })).toBeTruthy();
    expect(within(table).getByText('Pilot cohort (archived)')).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Archive Needs a call' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(within(table).queryByRole('button', { name: /Pilot cohort/ })).toBeNull();
  });

  it('creates a label with a colour from the list and shows it', async () => {
    const user = userEvent.setup();
    const created = { id: uuid(903), name: 'Site visit', colour: 'success', archived: false };
    const sent = await openManager({ [CREATE]: { status: 201, body: created } });
    await screen.findByRole('table', { name: 'Labels' });

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Site visit');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Colour' }), 'success');
    await user.click(screen.getByRole('button', { name: 'Create label' }));

    expect(await screen.findByRole('button', { name: 'Archive Site visit' })).toBeTruthy();
    expect(sent.find(({ key }) => key === CREATE)?.body).toEqual({
      name: 'Site visit',
      colour: 'success',
    });
  });

  it('shows the duplicate refusal in the error summary without repeating the name', async () => {
    const user = userEvent.setup();
    const taken = 'A label with this name already exists. Enter a different name.';
    await openManager({ [CREATE]: problem(409, taken, [{ field: 'body.name', message: taken }]) });
    await screen.findByRole('table', { name: 'Labels' });

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Needs a call');
    await user.click(screen.getByRole('button', { name: 'Create label' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(taken);
    expect(alert.textContent).not.toContain('Needs a call.');
  });

  it('archives a label after confirming', async () => {
    const user = userEvent.setup();
    const sent = await openManager({
      [`POST /console/labels/${urgent.id}/archive`]: ok({ ...urgent, archived: true }),
    });

    await user.click(await screen.findByRole('button', { name: 'Archive Needs a call' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive label' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive Needs a call' }));

    expect(await screen.findByText('Needs a call (archived)')).toBeTruthy();
    expect(sent.some(({ key }) => key === `POST /console/labels/${urgent.id}/archive`)).toBe(true);
  });
});
