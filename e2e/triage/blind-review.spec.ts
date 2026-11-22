// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Blind review through the triage surfaces: a blind reviewer is refused every
// notes, messages, owner, label, saved view and export route, sees no Notes or
// Messages section, and receives no note text, message text, applicant name,
// address or file name in any page or response the review page loads. The
// note and the message are written here first, so there is something to leak.
//
// It reads what the journey left, so it runs after the journey.

import type { Response } from '@playwright/test';

import { openReview } from '../../apps/console/e2e/assessment-steps.ts';
import { signInStaff, type Api } from '../support/api.ts';
import { groups } from '../support/applications.ts';
import { need, readState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';
import { ABSENT_ID } from '../platform/modules/routes.ts';
import { call, create, MESSAGE, needsJourney, NOTE } from './steps.ts';

inOrder();
needsJourney();

const applicationId = () => need('application1Id');

/** What a blind reviewer must never be sent. */
function giveaways(): string[] {
  const { people } = readState();
  return [
    'qzx-note',
    'qzx-message',
    'qzx-reply',
    'accounts-2026',
    need('accountsFileId'),
    ...groups.map(({ organisation }) => organisation),
    ...groups.map(({ familyName }) => familyName),
    ...Object.values(people).map(({ email }) => email),
  ];
}

let manager: Api;
let reviewer: Api;

test.describe('blind review through notes, messages and triage', () => {
  test.beforeAll(async () => {
    manager = await signInStaff('northfield', 'manager');
    reviewer = await signInStaff('northfield', 'reviewer1');
    const path = `/console/submissions/${applicationId()}`;
    await create(manager, `${path}/notes`, { body: NOTE });
    await create(manager, `${path}/messages`, { body: MESSAGE });
  });

  test.afterAll(async () => {
    await Promise.all([manager.dispose(), reviewer.dispose()]);
  });

  test('every notes, messages, triage, view and export route refuses a reviewer without echoing anything', async () => {
    const id = applicationId();
    const routes: [string, string, unknown?][] = [
      ['GET', `/console/submissions/${id}/notes`],
      ['POST', `/console/submissions/${id}/notes`, { body: NOTE }],
      ['GET', `/console/submissions/${id}/mentionable-members`],
      ['GET', `/console/submissions/${id}/messages`],
      ['POST', `/console/submissions/${id}/messages`, { body: MESSAGE }],
      ['PUT', `/console/submissions/${id}/owner`, { ownerId: null }],
      ['POST', '/console/submission-owners', { submissionIds: [id], ownerId: null }],
      ['PATCH', `/console/submissions/${id}/labels`, { add: [ABSENT_ID] }],
      ['GET', '/console/labels'],
      ['GET', '/console/saved-views'],
      ['POST', '/console/csv-exports', { viewId: ABSENT_ID }],
      ['GET', `/console/csv-exports/${ABSENT_ID}`],
      ['POST', '/console/board-packs', { applicationIds: [id] }],
      ['GET', `/console/board-packs/${ABSENT_ID}`],
    ];
    for (const [method, path, json] of routes) {
      const answer = await call(reviewer, method, path, json);
      expect([403, 404], `${method} ${path}`).toContain(answer.status);
      for (const giveaway of giveaways()) {
        expect(answer.text, `${method} ${path}`).not.toContain(giveaway);
      }
    }
  });

  test('the review page shows no notes or messages, and nothing it loads names the applicant or a file', async ({
    pages,
  }) => {
    const page = await pages.staff('reviewer1');
    const bodies: string[] = [];
    page.on('response', (response: Response) => {
      void response
        .text()
        .then((text) => bodies.push(`${response.url()}\n${text}`))
        .catch(() => undefined);
    });
    await page.goto('/northfield/reviews');
    await openReview(page, 0);
    await expect(page.getByRole('region', { name: 'Your review' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Notes' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Messages' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Notes' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Messages' })).toHaveCount(0);

    const html = await page.content();
    for (const giveaway of giveaways()) {
      expect(html, giveaway).not.toContain(giveaway);
      expect(bodies.join('\n'), giveaway).not.toContain(giveaway);
    }
    for (const url of ['/northfield/submissions', `/northfield/submissions/${applicationId()}`]) {
      await page.goto(url);
      await expect(page.getByRole('region', { name: 'Notes' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export as CSV' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create board pack' })).toHaveCount(0);
    }
  });
});
