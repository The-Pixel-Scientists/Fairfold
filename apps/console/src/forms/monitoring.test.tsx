// SPDX-License-Identifier: AGPL-3.0-or-later

import { monitoringTemplate } from '@pixel-scientists/grants/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stubApi } from '../testing/api.ts';
import { joined } from '../testing/names.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { SAVE, bodyOf, saves } from './builder.ts';
import { api, draft, ids, ok, published, reads, version } from './fixtures.ts';

setUpConsoleTests();

const form = `/northfield/rounds/${ids.round}/form`;
const announced = () => document.getElementById('monitoring-status')?.textContent;
const empty = version(ids.draft, 2, 'draft', null);

async function openMonitoringDraft(more = {}, from = empty) {
  const sent = stubApi({ ...reads(from, published), ...more });
  openConsole(`${form}/${from.id}?template=monitoring`);
  await screen.findByRole('heading', { level: 1, name: 'Equality monitoring form' });
  await screen.findByRole('list', { name: 'Questions' });
  return sent;
}

describe('the equality monitoring form', () => {
  it('starts a monitoring draft from the forms page and opens it as the template', async () => {
    const user = userEvent.setup();
    const started = version(ids.draft, 2, 'draft', null);
    stubApi({
      ...reads(published),
      [api.createDraft]: { status: 201, body: started },
      [api.version(ids.draft)]: ok(started),
    });
    openConsole(form);

    await user.click(
      await screen.findByRole('button', { name: 'Create equality monitoring draft' }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Equality monitoring form' }),
    ).toBeTruthy();
    expect(window.location.search).toBe('?template=monitoring');
  });

  it('asks every question of the set, optional and only in totals, with no audience control', async () => {
    await openMonitoringDraft();

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(monitoringTemplate().sections[0]?.fields.length ?? 0);
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(/seen only in totals/)).toBeTruthy();
    const page = within(screen.getByRole('main'));
    expect(page.queryByRole('combobox')).toBeNull();
    expect(page.queryByText(/identity|file/i)).toBeNull();
  });

  it('leaves a question out and saves the questions that are left', async () => {
    const user = userEvent.setup();
    const sent = await openMonitoringDraft(saves);

    await user.click(screen.getByRole('checkbox', { name: 'What is your religion or belief?' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(sent.some(({ key }) => key === SAVE)).toBe(true);
    });
    const { sections } = (
      bodyOf(sent, SAVE) as {
        definition: { sections: { fields: { id: string; audiences: string }[] }[] };
      }
    ).definition;
    expect(sections[0]?.fields.map((field) => field.id)).not.toContain('f_religion');
    expect(sections[0]?.fields.every((field) => field.audiences === 'aggregate_only')).toBe(true);
  });

  it('moves a question up', async () => {
    const user = userEvent.setup();
    await openMonitoringDraft();

    await user.click(
      screen.getByRole('button', {
        name: joined('Move up', 'Do you consider yourself to be disabled?'),
      }),
    );

    const names = screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);
    expect(names.slice(0, 2)).toEqual([
      'Do you consider yourself to be disabled?',
      'What is your age?',
    ]);
  });

  it('keeps focus on the button that moved a question and announces the new position', async () => {
    const user = userEvent.setup();
    await openMonitoringDraft();
    const total = screen.getAllByRole('checkbox').length;
    const down = () =>
      screen.getByRole('button', { name: joined('Move down', 'What is your age?') });

    await user.click(down());

    expect(document.activeElement).toBe(down());
    expect(announced()).toBe(`What is your age? moved to position 2 of ${String(total)}.`);
  });

  it('moves focus to the other button when a question reaches the top', async () => {
    const user = userEvent.setup();
    await openMonitoringDraft();

    await user.click(
      screen.getByRole('button', {
        name: joined('Move up', 'Do you consider yourself to be disabled?'),
      }),
    );

    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: joined('Move down', 'Do you consider yourself to be disabled?'),
      }),
    );
    expect(announced()).toMatch(/moved to position 1 of/);
  });

  it('refuses to publish with no questions and says what to do, linked from the summary', async () => {
    const user = userEvent.setup();
    const sent = await openMonitoringDraft(saves);

    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Publish version 2' }));

    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('Choose at least one question to ask.');
    expect(sent.some(({ key }) => key === api.publish(ids.draft))).toBe(false);
  });

  it('shows the contracts check beside a question that a draft changed', async () => {
    const [section] = monitoringTemplate().sections;
    const first = section?.fields[0];
    if (section === undefined || first?.type !== 'single_choice') throw new Error('No question.');
    const loose = version(ids.draft, 2, 'draft', {
      sections: [{ ...section, fields: [{ ...first, required: true }] }],
    });
    await openMonitoringDraft({}, loose);

    const message = (await screen.findAllByText(/Make this question optional/)).find((node) =>
      node.id.includes('-issue-'),
    );
    if (message === undefined) throw new Error('No message beside the question.');
    const group = screen.getByRole('group', { name: first.label });
    expect(group.getAttribute('aria-describedby')).toBe(message.id);
    expect(group.contains(screen.getByRole('checkbox', { name: first.label }))).toBe(true);
    expect(announced()).toContain(`${first.label}: ${message.textContent}`);
  });

  it('starts from the template when the draft holds application questions', async () => {
    await openMonitoringDraft({}, draft);

    expect(screen.getByRole('checkbox', { name: 'What is your age?' })).toBeTruthy();
    expect(screen.queryByText('Organisation name')).toBeNull();
  });
});
