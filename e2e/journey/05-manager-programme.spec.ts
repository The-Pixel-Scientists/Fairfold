// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 5: a programme manager creates Community Spaces Fund with a round
// (open for about three weeks in Europe/London, budget £150,000, awards from
// £5,000 to £25,000), the stages Intake, Review and Decision, a rubric of three
// weighted criteria scored 1 to 5, and the outcome emails. Each change shows in
// the configuration history. The dates are worked out from today, so the round
// is open whenever the journey runs; the demo's own were 12 October to
// 2 November.

import {
  addRubric,
  changeEmail,
  checkHistory,
  createProgramme,
  enterMoment,
} from '../../apps/console/e2e/programme-steps.ts';
import { axePages } from '../support/axe.ts';
import { londonMoment } from '../support/clock.ts';
import { need, updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

test.describe('step 5: the manager sets up Community Spaces Fund', () => {
  test('creates the programme and its round, then the rubric and the emails, and finds each change in the history', async ({
    pages,
  }) => {
    const page = await pages.staff('manager');
    await page.goto('/northfield/');
    await expect(page.getByRole('heading', { level: 2, name: 'No programmes yet' })).toBeVisible();
    await createProgramme(page);
    const programmeId = new URL(page.url()).pathname.split('/').at(-1) ?? '';

    const opens = londonMoment(-10, 9);
    const closes = londonMoment(21, 17);
    await page.getByRole('link', { name: 'New round' }).click();
    await expect(h1(page, 'New round')).toBeFocused();
    await page.getByRole('textbox', { name: 'Title' }).fill('Autumn 2026');
    await enterMoment(page, 'Opening', [opens.day, opens.month, opens.year], opens.time);
    await enterMoment(page, 'Closing', [closes.day, closes.month, closes.year], closes.time);
    await page.getByRole('textbox', { name: 'Budget' }).fill('150000');
    await page.getByRole('textbox', { name: 'Smallest award' }).fill('5000');
    await page.getByRole('textbox', { name: 'Largest award' }).fill('25000');
    await page.getByRole('button', { name: 'Add round' }).click();
    await expect(h1(page, 'Autumn 2026')).toBeFocused();
    const details = page.getByRole('tabpanel');
    await expect(details.getByText('£150,000')).toBeVisible();
    await expect(details.getByText(opens.words)).toBeVisible();
    await expect(details.getByText(closes.words)).toBeVisible();
    await expect(details.getByText('Europe/London')).toBeVisible();
    const roundId = new URL(page.url()).pathname.split('/').at(-1) ?? '';

    await addRubric(page);
    await changeEmail(page, 'Community Spaces Fund');
    await checkHistory(page);

    const { stages } = (await (
      await page.request.get(`/api/console/rounds/${roundId}/stages`)
    ).json()) as {
      stages: { id: string; name: string; criteria?: { id: string }[] }[];
    };
    expect(stages.map(({ name }) => name)).toEqual(['Intake', 'Review', 'Decision']);
    const idOf = (name: string) => stages.find((stage) => stage.name === name)?.id ?? '';
    updateState((state) => {
      Object.assign(state.ids, {
        programmeId,
        roundId,
        intakeStageId: idOf('Intake'),
        closingUkTime: closes.ukTime,
        reviewStageId: idOf('Review'),
        decisionStageId: idOf('Decision'),
      });
    });
  });

  test('keeps the programme and round after a reload, with the budget and the stages', async ({
    pages,
  }) => {
    const page = await pages.staff('manager');
    await page.goto('/northfield/');
    const row = page.getByRole('row', { name: /Community Spaces Fund/ });
    await expect(row).toContainText('Autumn 2026');
    await expect(row).toContainText('£150,000');
    await page.goto(`/northfield/rounds/${need('roundId')}`);
    await page.getByRole('tab', { name: 'Stages and rubrics' }).click();
    await expect(
      page.getByRole('row', { name: /Review.*3 criteria, total weight 10/ }),
    ).toBeVisible();
  });

  test('@a11y the programme pages have no axe violations', async ({ pages }) => {
    const programme = `/northfield/programmes/${need('programmeId')}`;
    const round = `/northfield/rounds/${need('roundId')}`;
    await axePages(await pages.staff('manager'), [
      '/northfield/',
      programme,
      `${programme}/emails`,
      round,
      `${round}/stages`,
      `${round}/stages/${need('reviewStageId')}/rubric`,
    ]);
  });
});
