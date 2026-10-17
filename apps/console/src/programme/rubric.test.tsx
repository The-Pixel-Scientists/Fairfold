// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { joined } from '../testing/names.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, ids, manager, ok, reads, round, stages, nth } from './fixtures.ts';
import type { Handlers } from './fixtures.ts';

setUpConsoleTests();

const open = async (stage: string = ids.review, more: Handlers = {}) => {
  const sent = stubApi({ ...manager(), ...reads, ...more });
  openConsole(`/northfield/rounds/${round.id}/stages/${stage}/rubric`);
  await screen.findByRole('heading', { level: 1, name: /^Rubric/ });
  return sent;
};

const labels = () =>
  screen
    .getAllByRole<HTMLInputElement>('textbox', { name: /^Criterion\s*\d/ })
    .map((box) => box.value);
const button = (verb: string, criterion: string) =>
  screen.getByRole('button', { name: joined(verb, criterion) });
const total = () => screen.getByText('Total weight').nextElementSibling?.textContent;

describe('the rubric of a stage', () => {
  it('shows each criterion with its weight and scale, and the total weight', async () => {
    await open();

    await screen.findByDisplayValue('Need');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rubric for Review' }),
    ).toBeTruthy();
    expect(labels()).toEqual(['Need', 'Approach', 'Value for money']);
    expect(
      screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Weight/ }).map((box) => box.value),
    ).toEqual(['5', '3', '2']);
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: /^Lowest score/ })
        .map((box) => box.value),
    ).toEqual(['1', '1', '1']);
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: /^Highest score/ })
        .map((box) => box.value),
    ).toEqual(['5', '5', '5']);
    expect(screen.getByDisplayValue('Is there evidence of local need?')).toBeTruthy();
    expect(total()).toBe('10');
    const meters = screen.getAllByRole('meter');
    expect(meters.map((meter) => meter.getAttribute('aria-valuetext'))).toEqual([
      '50%',
      '30%',
      '20%',
    ]);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Autumn 2026' })).toBeTruthy();
  });

  it('keeps the total up to date as weights change', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByDisplayValue('Need');

    const first = nth(screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Weight/ }), 0);
    await user.clear(first);
    await user.type(first, '8');

    expect(total()).toBe('13');
    expect(
      screen.getAllByRole('meter').map((meter) => meter.getAttribute('aria-valuetext')),
    ).toEqual(['62%', '23%', '15%']);
  });

  it('adds a criterion with the usual scale and puts the cursor in it', async () => {
    const user = userEvent.setup();
    await open(ids.intake);

    expect(
      await screen.findByRole('heading', { level: 3, name: 'No rubric for this stage' }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Add a criterion to make this a stage where reviewers score/),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add criterion' }));

    expect(labels()).toEqual(['']);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /^Criterion\s*1$/ }));
    });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Lowest score/ }).value).toBe(
      '1',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Highest score/ }).value).toBe(
      '5',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Weight/ }).value).toBe('');
  });

  it('moves and removes criteria with buttons, and says what happened', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByDisplayValue('Need');

    await user.click(button('Move down', 'Need'));
    expect(labels()).toEqual(['Approach', 'Need', 'Value for money']);
    expect(screen.getByText('Need moved to position 2 of 3')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(button('Move down', 'Need'));
    });

    await user.click(button('Remove', 'Approach'));
    expect(labels()).toEqual(['Need', 'Value for money']);
    expect(screen.getByText('Approach removed')).toBeTruthy();
  });

  it('saves the rubric with the id of each criterion that exists, then shows the saved total', async () => {
    const user = userEvent.setup();
    const sent = await open(ids.review, {
      [api.setRubric]: (body) => {
        const { criteria } = body as { criteria: object[] };
        return ok({
          ...stages[1],
          criteria: criteria.map((criterion, index) => ({
            id: ids.need,
            guidance: '',
            ...criterion,
            ...(index === 3 ? { id: 'a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4' } : {}),
          })),
        });
      },
    });
    await screen.findByDisplayValue('Need');
    await user.click(screen.getByRole('button', { name: 'Add criterion' }));
    await user.type(screen.getByRole('textbox', { name: /^Criterion\s*4$/ }), 'Reach');
    await user.type(nth(screen.getAllByRole('textbox', { name: /^Weight/ }), 3), '4');
    await user.clear(nth(screen.getAllByRole('textbox', { name: /^Highest score/ }), 3));
    await user.type(nth(screen.getAllByRole('textbox', { name: /^Highest score/ }), 3), '10');

    await user.click(screen.getByRole('button', { name: 'Save rubric' }));

    expect(await screen.findByText('Rubric saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === api.setRubric)?.body).toEqual({
      criteria: [
        {
          id: ids.need,
          label: 'Need',
          guidance: 'Is there evidence of local need?',
          weight: 5,
          scaleMin: 1,
          scaleMax: 5,
        },
        { id: ids.approach, label: 'Approach', guidance: '', weight: 3, scaleMin: 1, scaleMax: 5 },
        {
          id: ids.value,
          label: 'Value for money',
          guidance: '',
          weight: 2,
          scaleMin: 1,
          scaleMax: 5,
        },
        { label: 'Reach', guidance: '', weight: 4, scaleMin: 1, scaleMax: 10 },
      ],
    });
    await user.click(screen.getByRole('link', { name: 'Back to round' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says what is wrong beside each box and in a summary, and sends nothing', async () => {
    const user = userEvent.setup();
    const sent = await open();
    await screen.findByDisplayValue('Need');
    await user.clear(screen.getByDisplayValue('Approach'));
    const second = nth(screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Weight/ }), 1);
    await user.clear(second);
    const high = nth(
      screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Highest score/ }),
      2,
    );
    await user.clear(high);
    await user.type(high, '1');

    await user.click(screen.getByRole('button', { name: 'Save rubric' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Enter a label for the criterion.',
      'Enter a weight from 1 to 100.',
      'Enter a lowest score that is less than the highest score.',
    ]);
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['#criterion-1-label', '#criterion-1-weight', '#criterion-2-scaleMax']);
    expect(second.getAttribute('aria-invalid')).toBe('true');
    expect(sent.map(({ key }) => key)).not.toContain(api.setRubric);
  });

  it('refuses a weight outside 1 to 100, in the contract words', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByDisplayValue('Need');
    const first = nth(screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Weight/ }), 0);
    await user.clear(first);
    await user.type(first, '101');

    await user.click(screen.getByRole('button', { name: 'Save rubric' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').getAttribute('href')).toBe('#criterion-0-weight');
  });

  it("shows the API's refusal beside the criterion it names", async () => {
    const user = userEvent.setup();
    await open(ids.review, {
      [api.setRubric]: problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [{ field: 'body.criteria.2.weight', message: 'Enter a smaller weight.' }],
      ),
    });
    await screen.findByDisplayValue('Need');
    await user.type(screen.getByDisplayValue('Need'), '!');

    await user.click(screen.getByRole('button', { name: 'Save rubric' }));

    expect(await screen.findAllByText('Enter a smaller weight.')).toHaveLength(2);
    expect(
      nth(screen.getAllByRole('textbox', { name: /^Weight/ }), 2).getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('asks before leaving with changes that are not saved', async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByDisplayValue('Need');
    await user.type(screen.getByDisplayValue('Need'), ' of the area');

    await user.click(screen.getByRole('link', { name: 'Back to round' }));

    expect(await screen.findByRole('dialog', { name: 'Leave this page?' })).toBeTruthy();
  });

  it('says so when the stage is not in the round', async () => {
    await open('11111111-2222-4333-8444-555555555555');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'We cannot find this stage' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to round' }).getAttribute('href')).toBe(
      `/northfield/rounds/${round.id}`,
    );
  });
});
