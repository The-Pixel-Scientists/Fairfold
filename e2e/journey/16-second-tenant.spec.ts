// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 16: signed in to the second funder, nothing of the first is
// visible, in the console, in the portal and in what the API gives. The API
// and database walks that prove it route by route are in 16b and in
// isolation/database.spec.ts.

import { signInApplicant, Api } from '../support/api.ts';
import { createApplicantAccount } from '../support/applicants.ts';
import { groups } from '../support/applications.ts';
import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { consoleOrigin } from '../support/env.ts';
import { need, person, readState } from '../support/state.ts';
import { nextCode } from '../support/totp.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

/** Words that belong to the first funder alone. */
function firstFunder(): string[] {
  return [
    'Northfield',
    'Eastmere',
    'Sunita Rao',
    'Ada Morgan',
    ...groups.map(({ organisation }) => organisation),
  ];
}

test.describe('step 16: the second funder sees nothing of the first', () => {
  test('its console shows its own empty programmes and submissions, and the first funder’s records are not found', async ({
    pages,
  }) => {
    const page = await pages.staff('eastManager', 'eastmoor');
    await page.goto('/eastmoor/');
    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'No programmes yet' })).toBeVisible();
    for (const word of firstFunder())
      await expect(page.getByRole('main'), word).not.toContainText(word);

    await page.goto('/eastmoor/submissions');
    await expect(h1(page, 'Submissions')).toBeVisible();
    for (const word of firstFunder())
      await expect(page.getByRole('main'), word).not.toContainText(word);

    // The first funder's submission, programme and round are not found, by address and by API.
    for (const path of [
      `/eastmoor/submissions/${need('application1Id')}`,
      `/eastmoor/programmes/${need('programmeId')}`,
      `/eastmoor/rounds/${need('roundId')}`,
    ]) {
      await page.goto(path);
      await expect(h1(page, /./).first()).toBeVisible();
      for (const word of firstFunder())
        await expect(page.getByRole('main'), path).not.toContainText(word);
    }
    for (const path of [
      `/console/submissions/${need('application1Id')}`,
      `/console/programmes/${need('programmeId')}`,
      `/console/rounds/${need('roundId')}`,
      `/console/rounds/${need('roundId')}/decisions`,
    ]) {
      expect((await page.request.get(`/api${path}`)).status(), path).toBe(404);
    }
  });

  test('its administrator sees its own team and audit log, and the first funder is in neither', async ({
    pages,
  }) => {
    const page = await pages.staff('eastAdmin', 'eastmoor');
    await page.goto('/eastmoor/team');
    await expect(h1(page, 'Team')).toBeVisible();
    const members = page.getByRole('table', { name: /^Members of / });
    await expect(members).toContainText('idris.fenwick@eastmoor.example');
    await expect(members).not.toContainText('northfield');
    await expect(members.locator('tbody > tr')).toHaveCount(4);

    const events = await auditEvents(page.request);
    const text = JSON.stringify(events);
    for (const word of [
      ...firstFunder(),
      need('programmeId'),
      need('roundId'),
      need('application1Id'),
    ]) {
      expect(text, word).not.toContain(word);
    }
    for (const event of events) expect(event.action).not.toMatch(/^grants\./);
  });

  test('its applicants see none of the first funder’s programmes, and cannot apply to its round', async ({
    pages,
  }) => {
    await createApplicantAccount('eastApplicantPage', 'eastmoor');
    const page = await pages.applicant('eastApplicantPage', 'eastmoor');
    await page.goto('/eastmoor/programmes');
    await expect(h1(page, 'Programmes you can apply to')).toBeVisible();
    for (const word of firstFunder())
      await expect(page.getByRole('main'), word).not.toContainText(word);

    const api = await signInApplicant('eastmoor', 'eastApplicantPage');
    expect((await api.send('GET', `/portal/rounds/${need('roundId')}`)).status).toBe(404);
    expect((await api.send('GET', `/portal/applications/${need('application1Id')}`)).status).toBe(
      404,
    );
    await api.dispose();
  });

  test('its staff have no way into the first funder’s console', async () => {
    const { email, password } = person('eastManager');
    const api = await Api.open(consoleOrigin);
    const session = await api.send('POST', '/auth/tenants/northfield/sign-in', {
      json: { email, password },
    });
    // Whether the sign-in is turned away or ends in a session with no membership, no data follows.
    if (session.status === 200) {
      const verified = await api.send('POST', '/auth/totp/verify', {
        json: { code: await nextCode('eastManager') },
      });
      expect(verified.text).not.toContain('"activeMembership":{');
    }
    for (const path of [
      '/console/programmes',
      '/console/submissions',
      `/console/rounds/${need('roundId')}`,
    ]) {
      const answer = await api.send('GET', path);
      expect([401, 403], path).toContain(answer.status);
      for (const word of firstFunder()) expect(answer.text, path).not.toContain(word);
    }
    await api.dispose();
    expect(readState().people['eastManager']?.key).toBeDefined();
  });

  test('each funder keeps its own look', async ({ pages }) => {
    const visitor = await pages.visitor();
    const accents: string[] = [];
    for (const slug of ['northfield', 'eastmoor']) {
      const css = await visitor.request.get(`/api/public/tenants/${slug}/theme.css`);
      expect(css.status()).toBe(200);
      accents.push(/--color-accent:\s*(#[0-9a-f]{6});/i.exec(await css.text())?.[1] ?? '');
    }
    expect(accents[0]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(accents[1]?.toLowerCase()).toBe('#0b6e4f');
    expect(accents[0]).not.toBe(accents[1]);
  });

  test('@a11y the second funder’s pages have no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('eastManager', 'eastmoor'), [
      '/eastmoor/',
      '/eastmoor/submissions',
    ]);
    await axePages(await pages.applicant('eastApplicantPage', 'eastmoor'), [
      '/eastmoor/programmes',
    ]);
  });
});
