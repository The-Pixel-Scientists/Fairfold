// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Backup codes (ADR 0010): a staff member makes them after step-up and they
// are shown once; one completes a sign-in once and then never again; making
// new ones ends every earlier code; five wrong codes end the pending sign-in.
// No code is printed: checks on a code compare to a boolean, not to the text.

import { expectNoViolations } from '../../apps/portal/e2e/axe.ts';
import { Api, signInStaff } from '../support/api.ts';
import { auditEvents } from '../support/audit.ts';
import { consoleOrigin } from '../support/env.ts';
import { subjectsTo } from '../support/mail.ts';
import { person } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';
import {
  afterTheJourney,
  confirmIfAsked,
  createStaff,
  deleteMessagesTo,
  paced,
  startSignIn,
} from './people.ts';

inOrder();
afterTheJourney();

const WHO = 'codesManager';
const WRONG = ['aaaaa-aaaa1', 'aaaaa-aaaa2', 'aaaaa-aaaa3', 'aaaaa-aaaa4', 'aaaaa-aaaa5'];

/** The codes the staff member holds now; the first test makes them. */
let codes: string[] = [];

/** The administrator's audit log, filtered to one action. */
async function eventsOf(action: string) {
  const admin = await signInStaff('northfield', 'colleague');
  const events = await auditEvents(admin, { action });
  await admin.dispose();
  return events;
}

/** A refusal by the code, not by the limits: a 429 is never counted as a pass. */
function expectRefused(status: number, what: string): void {
  expect(status, what).toBeGreaterThanOrEqual(400);
  expect(status, what).toBeLessThan(500);
  expect(status, `${what} was rate limited`).not.toBe(429);
}

const countOf = async (action: string) => (await eventsOf(action)).length;

const hasSubject = async (email: string, pattern: RegExp) =>
  (await subjectsTo(email)).some((subject) => pattern.test(subject));

test.describe('backup codes', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await createStaff(WHO, 'programme_manager');
  });

  test.afterAll(async () => {
    await deleteMessagesTo(person(WHO).email);
  });

  test('@a11y a staff member makes codes after step-up, and they are shown once', async ({
    pages,
  }) => {
    const page = await pages.staff(WHO);
    const visited: string[] = [];
    page.on('framenavigated', (frame) => visited.push(frame.url()));
    await page.goto('/northfield/account/security');
    await expect(h1(page, 'Account security')).toBeVisible();
    await expect(page.getByText('You have no backup codes left.')).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'Generate backup codes' }).click();
    const shown = page.getByRole('group', { name: 'Your backup codes' });
    await confirmIfAsked(page, WHO, shown);
    codes = await shown.getByRole('listitem').allTextContents();
    expect(codes).toHaveLength(10);
    await expectNoViolations(page);

    const kept = await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
        document.title,
        location.href,
        history.state,
      ]),
    );
    expect(
      codes.some((code) => kept.includes(code)),
      'a code is kept in storage, the title or the history',
    ).toBe(false);
    expect(
      codes.some((code) => visited.some((url) => url.includes(code))),
      'a code is in an address',
    ).toBe(false);

    await page.getByRole('button', { name: 'I have saved my codes' }).click();
    await expect(shown).toHaveCount(0);
    await expect(page.getByText('You have 10 backup codes left.')).toBeVisible();

    await page.goto('/northfield/team');
    await page.goBack();
    await expect(h1(page, 'Account security')).toBeVisible();
    await expect(shown).toHaveCount(0);
    const html = await page.content();
    expect(
      codes.some((code) => html.includes(code)),
      'a code is back on the page',
    ).toBe(false);
  });

  test('one code completes sign-in with a password once, and the event and email carry no code', async ({
    pages,
  }) => {
    const { email, password } = person(WHO);
    const before = await countOf('platform.auth.backup_code_used');

    const page = await pages.visitor('console');
    await startSignIn(page, email, password);
    await expect(h1(page, 'Enter your code')).toBeVisible();
    await page.getByRole('button', { name: 'Use a backup code' }).click();
    await expect(h1(page, 'Use a backup code')).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel('Backup code').fill(codes[0] ?? '');
    await page.getByRole('button', { name: 'Confirm backup code' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    const again = await pages.visitor('console');
    await startSignIn(again, email, password);
    await again.getByRole('button', { name: 'Use a backup code' }).click();
    await again.getByLabel('Backup code').fill(codes[0] ?? '');
    await again.getByRole('button', { name: 'Confirm backup code' }).click();
    await expect(again.getByText('That backup code is not right.')).toBeVisible();
    await expect(again.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    await expect.poll(() => countOf('platform.auth.backup_code_used')).toBe(before + 1);
    const text = JSON.stringify(await eventsOf('platform.auth.backup_code_used'));
    expect(
      codes.some((code) => text.includes(code)),
      'a code is in the event',
    ).toBe(false);
    await expect.poll(() => hasSubject(email, /backup code was used to sign in/i)).toBe(true);
  });

  test('@a11y new codes ask for step-up first and end every earlier code', async ({ pages }) => {
    const { email, password } = person(WHO);
    const before = await countOf('platform.auth.backup_codes_regenerated');

    // A sign-in by backup code has not re-authenticated, so the change asks first.
    const page = await pages.visitor('console');
    await startSignIn(page, email, password);
    await page.getByRole('button', { name: 'Use a backup code' }).click();
    await page.getByLabel('Backup code').fill(codes[1] ?? '');
    await page.getByRole('button', { name: 'Confirm backup code' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    await page.goto('/northfield/account/security');
    await page.getByRole('button', { name: 'Generate new backup codes' }).click();
    await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toBeVisible();
    await expectNoViolations(page);
    const shown = page.getByRole('group', { name: 'Your backup codes' });
    await confirmIfAsked(page, WHO, shown);
    const fresh = await shown.getByRole('listitem').allTextContents();
    expect(fresh).toHaveLength(10);
    expect(
      fresh.some((code) => codes.includes(code)),
      'a new code repeats an old one',
    ).toBe(false);

    const old = await Api.open(consoleOrigin);
    await paced('sign-in', () =>
      old.send('POST', '/auth/tenants/northfield/sign-in', { json: { email, password } }),
    );
    const refused = await old.send('POST', '/auth/backup-codes/verify', {
      json: { code: codes[2] },
    });
    expectRefused(refused.status, 'an earlier code');
    await old.dispose();

    const current = await Api.open(consoleOrigin);
    await paced('sign-in', () =>
      current.send('POST', '/auth/tenants/northfield/sign-in', { json: { email, password } }),
    );
    await current.ok('POST', '/auth/backup-codes/verify', { json: { code: fresh[0] } });
    await current.dispose();
    codes = fresh;

    await expect.poll(() => countOf('platform.auth.backup_codes_regenerated')).toBe(before + 1);
    await expect.poll(() => hasSubject(email, /New backup codes were made/i)).toBe(true);
  });

  // Last: wrong codes count towards the sign-in limits for this address.
  test('five wrong codes end the pending sign-in, and the sixth is refused even if it is right', async () => {
    const { email, password } = person(WHO);
    const api = await Api.open(consoleOrigin);
    await paced('sign-in', () =>
      api.send('POST', '/auth/tenants/northfield/sign-in', { json: { email, password } }),
    );
    for (const wrong of WRONG) {
      const answer = await api.send('POST', '/auth/backup-codes/verify', { json: { code: wrong } });
      expectRefused(answer.status, 'a wrong code');
    }
    const sixth = await api.send('POST', '/auth/backup-codes/verify', { json: { code: codes[3] } });
    expectRefused(sixth.status, 'the sixth code');
    expect((await api.send('GET', '/console/team')).status).toBe(401);
    await api.dispose();
  });
});
