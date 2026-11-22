// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "How we contact you", in a real browser with the API stubbed. The applicant
// keeps what is saved, so a spec can change a choice and reload.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { problem, stubSignedIn } from './auth-api.ts';
import { LABEL, PREFERENCES, choices } from './preferences-api.ts';

test.describe('how we contact you', () => {
  test('turns a purpose off, saves it and sees it kept after a reload', async ({ page }) => {
    let state: 'given' | 'withdrawn' = 'given';
    const sent = await stubSignedIn(
      page,
      {},
      {
        [`GET ${PREFERENCES}`]: () => choices(state),
        [`PUT ${PREFERENCES}`]: (body) => {
          state = (body as { state: 'given' | 'withdrawn' }).state;
          return choices(state);
        },
      },
    );
    await page.goto('/northfield/preferences');

    await expect(page.getByRole('heading', { level: 1, name: 'How we contact you' })).toBeVisible();
    await expect(page.getByRole('group', { name: LABEL })).toBeVisible();
    expect(sent.filter(({ key }) => key.startsWith('PUT'))).toEqual([]);

    await page.getByRole('radio', { name: 'No' }).check();
    await page.getByRole('button', { name: 'Save my choice' }).click();
    await expect(page.getByText(`Saved. ${LABEL}: no.`)).toBeVisible();
    expect(sent.at(-1)?.body).toEqual({
      purpose: 'future_funding',
      channel: 'email',
      state: 'withdrawn',
      privacyNoticeVersion: '1.0',
    });

    await page.reload();
    await expect(page.getByRole('radio', { name: 'No' })).toBeChecked();
    await expect(
      page.getByText('You turned this off. You can turn it back on here.'),
    ).toBeVisible();
  });

  test('shows the server refusal in the error summary', async ({ page }) => {
    await stubSignedIn(
      page,
      {},
      {
        [`GET ${PREFERENCES}`]: choices('given'),
        [`PUT ${PREFERENCES}`]: problem(403, 'You cannot change this.'),
      },
    );
    await page.goto('/northfield/preferences');

    await page.getByRole('radio', { name: 'No' }).check();
    await page.getByRole('button', { name: 'Save my choice' }).click();

    await expect(page.getByRole('alert', { name: 'There is a problem' })).toContainText(
      'You cannot change this.',
    );
  });
});
