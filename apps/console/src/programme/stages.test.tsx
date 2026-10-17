// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { joined } from '../testing/names.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, heading, ids, manager, ok, reads, round } from './fixtures.ts';
import type { Handlers } from './fixtures.ts';

setUpConsoleTests();

const open = async (more: Handlers = {}) => {
  const sent = stubApi({ ...manager(), ...reads, ...more });
  openConsole(`/northfield/rounds/${round.id}/stages`);
  await heading('Stages');
  await screen.findByDisplayValue('Intake');
  return sent;
};

const names = () =>
  screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Stage name/ }).map((box) => box.value);
const button = (verb: string, stage: string) =>
  screen.getByRole('button', { name: joined(verb, stage) });

describe('the stages of a round', () => {
  it('lists the stages in order, each with buttons to move and remove it', async () => {
    await open();

    expect(names()).toEqual(['Intake', 'Review', 'Decision']);
    expect(button('Move up', 'Intake').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move down', 'Intake').getAttribute('aria-disabled')).toBeNull();
    expect(button('Move down', 'Decision').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/A round has up to 10 stages/)).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Autumn 2026' })).toBeTruthy();
  });

  it('moves a stage with buttons, keeps focus on the button, and says where it went', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(button('Move down', 'Intake'));

    expect(names()).toEqual(['Review', 'Intake', 'Decision']);
    expect(screen.getByText('Intake moved to position 2 of 3')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(button('Move down', 'Intake'));
    });

    await user.click(button('Move up', 'Intake'));
    await user.click(button('Move up', 'Intake'));
    expect(names()).toEqual(['Intake', 'Review', 'Decision']);
    expect(document.activeElement).toBe(button('Move up', 'Intake'));
  });

  it('moves a stage from the keyboard alone', async () => {
    const user = userEvent.setup();
    await open();

    button('Move down', 'Review').focus();
    await user.keyboard('{Enter}');

    expect(names()).toEqual(['Intake', 'Decision', 'Review']);
    await waitFor(() => {
      expect(document.activeElement).toBe(button('Move down', 'Review'));
    });
  });

  it('adds a stage and puts the cursor in its name', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('button', { name: 'Add stage' }));

    expect(names()).toEqual(['Intake', 'Review', 'Decision', '']);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Stage name\s*4/ }));
    });
    expect(screen.getByText('Stage added')).toBeTruthy();
  });

  it('removes a stage, moves focus to the next name, and keeps at least one', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(button('Remove', 'Review'));

    expect(names()).toEqual(['Intake', 'Decision']);
    expect(screen.getByText('Review removed')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByDisplayValue('Decision'));
    });
    await user.click(button('Remove', 'Decision'));
    expect(button('Remove', 'Intake').getAttribute('aria-disabled')).toBe('true');
    await user.click(button('Remove', 'Intake'));
    expect(names()).toEqual(['Intake']);
  });

  it('stops adding at ten stages, and says why', async () => {
    const user = userEvent.setup();
    await open();

    for (let count = 3; count < 11; count += 1) {
      await user.click(screen.getByRole('button', { name: 'Add stage' }));
    }

    expect(names()).toHaveLength(10);
    const add = screen.getByRole('button', { name: 'Add stage' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBe('stage-limit');
  });

  it('saves the names in order, with the id of each stage that already exists', async () => {
    const user = userEvent.setup();
    const sent = await open({
      [api.setStages]: (body) => {
        const { stages: sentStages } = body as { stages: { id?: string; name: string }[] };
        return ok({
          stages: sentStages.map((stage, index) => ({
            id: stage.id ?? 'a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4',
            name: stage.name,
            position: index + 1,
            criteria: [],
          })),
        });
      },
    });
    await user.clear(screen.getByDisplayValue('Decision'));
    await user.type(screen.getByRole('textbox', { name: /Stage name\s*3/ }), 'Award');
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    await user.type(screen.getByRole('textbox', { name: /Stage name\s*4/ }), 'Monitoring');
    await user.click(button('Move up', 'Review'));

    await user.click(screen.getByRole('button', { name: 'Save stages' }));

    expect(await screen.findByText('Stages saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === api.setStages)?.body).toEqual({
      stages: [
        { id: ids.review, name: 'Review' },
        { id: ids.intake, name: 'Intake' },
        { id: ids.decision, name: 'Award' },
        { name: 'Monitoring' },
      ],
    });
    expect(names()).toEqual(['Review', 'Intake', 'Award', 'Monitoring']);
    await user.click(screen.getByRole('link', { name: 'Back to round' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says which stage needs a name or a different name, beside it and in a summary', async () => {
    const user = userEvent.setup();
    const sent = await open();
    await user.clear(screen.getByDisplayValue('Decision'));
    await user.click(screen.getByRole('button', { name: 'Save stages' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').textContent).toBe('Enter a name for the stage.');
    expect(
      screen.getByRole('textbox', { name: /Stage name\s*3/ }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(sent.map(({ key }) => key)).not.toContain(api.setStages);

    await user.type(screen.getByRole('textbox', { name: /Stage name\s*3/ }), 'review');
    await user.click(screen.getByRole('button', { name: 'Save stages' }));

    const again = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(again).getByRole('link').textContent).toBe('Give each stage a different name.');
    expect(
      screen.getByRole('textbox', { name: /Stage name\s*3/ }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByRole('textbox', { name: /Stage name\s*2/ }).getAttribute('aria-invalid'),
    ).toBeNull();
  });

  it("shows the API's refusal beside the stage it names", async () => {
    const user = userEvent.setup();
    await open({
      [api.setStages]: problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [{ field: 'body.stages.1.name', message: 'Give each stage a different name.' }],
      ),
    });
    await user.type(screen.getByDisplayValue('Intake'), '!');

    await user.click(screen.getByRole('button', { name: 'Save stages' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').getAttribute('href')).toBe('#stage-1-name');
    expect(
      screen.getByRole('textbox', { name: /Stage name\s*2/ }).getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('asks before leaving with changes that are not saved, including a change of order', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(button('Move down', 'Intake'));

    await user.click(screen.getByRole('link', { name: 'Back to round' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(names()).toEqual(['Review', 'Intake', 'Decision']);

    await user.click(button('Move up', 'Intake'));
    await user.click(screen.getByRole('link', { name: 'Back to round' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/northfield/rounds/${round.id}`);
    });
  });
});
