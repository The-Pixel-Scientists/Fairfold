// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The impact screens in a real browser, with the API's answers stubbed
// (impact-api.ts): a funder that keeps the framework, targets and results a
// member makes. Every spec also fails on a Content Security Policy
// violation, so the screens are checked under the production policy in
// console-production.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';

import { frameworkId, stubImpact } from './impact-api.ts';

/** Each page loads its code when it is first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

test.describe('outcomes frameworks', () => {
  test('makes a framework, sets a target, records a result and shows the progress', async ({
    page,
  }) => {
    const impact = await stubImpact(page);
    await page.goto('/northfield/impact');

    await expect(page.getByText('No outcomes frameworks yet')).toBeVisible();
    await page.getByRole('link', { name: 'Create a framework' }).click();

    await page.getByLabel('Name', { exact: true }).fill('Wellbeing');
    await page.getByLabel('Outcome 1 name').fill('Less isolation');
    await page.getByRole('button', { name: 'Add an indicator to outcome 1' }).click();
    await expect(page.getByLabel('Indicator 1.1 name')).toBeFocused();
    await page.getByLabel('Indicator 1.1 name').fill('Walks led');
    await page.getByRole('button', { name: 'Create framework' }).click();

    await expect(page).toHaveURL(new RegExp(`/northfield/impact/${frameworkId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Wellbeing' })).toBeVisible();
    const progress = page.getByRole('table', { name: 'Progress by indicator' });
    await expect(progress.getByRole('row', { name: /Walks led/ })).toContainText('No target set');

    await page.getByRole('button', { name: 'Set a target' }).click();
    const targetDialog = page.getByRole('dialog', { name: 'Set a target' });
    await targetDialog.getByRole('button', { name: 'Set target' }).click();
    await expect(targetDialog.getByRole('alert')).toBeFocused();
    await expect(targetDialog.getByText('Choose an indicator.')).toHaveCount(2);

    await targetDialog.getByLabel('Indicator').selectOption({ label: 'Walks led' });
    await targetDialog.getByLabel('Period starts').fill('2026-04-01');
    await targetDialog.getByLabel('Period ends').fill('2027-03-31');
    await targetDialog.getByLabel('Target', { exact: true }).fill('120');
    await targetDialog.getByRole('button', { name: 'Set target' }).click();
    await expect(targetDialog).toBeHidden();
    await expect(page.getByRole('table', { name: 'Targets' })).toContainText(
      '1 April 2026 to 31 March 2027',
    );

    await page.getByRole('button', { name: 'Record a result' }).click();
    const resultDialog = page.getByRole('dialog', { name: 'Record a result' });
    await resultDialog.getByLabel('Indicator').selectOption({ label: 'Walks led' });
    await resultDialog.getByLabel('Period starts').fill('2026-04-01');
    await resultDialog.getByLabel('Period ends').fill('2026-06-30');
    await resultDialog.getByLabel('Result', { exact: true }).fill('30');
    await resultDialog.getByRole('button', { name: 'Record result' }).click();
    await expect(resultDialog).toBeHidden();

    await expect(page.getByRole('table', { name: 'Results' })).toContainText('Walks led');
    await expect(progress.getByRole('row', { name: /Walks led/ })).toContainText('25% of the way');
    expect(
      impact.sent.find(({ key }) => key === 'POST /console/indicator-results')?.body,
    ).toMatchObject({ value: 30, programmeId: null });
  });

  test('gives a member who only reads no controls to change anything', async ({ page }) => {
    await stubImpact(page, { permissions: ['impact.frameworks.read'] });
    await page.goto('/northfield/impact');

    await expect(page.getByText('No outcomes frameworks yet')).toBeVisible();
    await expect(page.getByRole('link', { name: /framework/i })).toHaveCount(0);
  });
});
