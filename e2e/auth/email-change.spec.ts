// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing the sign-in email address (ADR 0010): after re-authentication, an
// emailed link opens a page that changes nothing until its button is pressed;
// the old address is told, other sessions end and this one stays; the old
// address then gets the answer an unknown one gets. No address is ever in a
// URL the browser visits.

import type { BrowserContext } from '@playwright/test';

import { expectNoViolations } from '../../apps/portal/e2e/axe.ts';
import { Api, signInStaff } from '../support/api.ts';
import { addressFor, createApplicantAccount } from '../support/applicants.ts';
import { auditEvents } from '../support/audit.ts';
import { consoleOrigin, portalOrigin } from '../support/env.ts';
import { waitForLink, waitForMessages } from '../support/mail.ts';
import { person, updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';
import { afterTheJourney, confirmIfAsked, createStaff, deleteMessagesTo, paced } from './people.ts';

inOrder();
afterTheJourney();

const STAFF = 'mailManager';
const APPLICANT = 'mailApplicant';

/** The addresses the specs made, so the mailbox is cleared afterwards. */
const used: string[] = [];

/** Collects every address the browser visits in a context, to prove none holds an email address. */
function watchAddresses(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (request) => urls.push(request.url()));
  return urls;
}

const holdsAddress = (urls: string[]) => urls.some((url) => /@|%40/i.test(url));

/** What signing in answers, without anything that varies between two requests. */
async function signInAnswer(origin: string, email: string, password: string) {
  const api = await Api.open(origin);
  const answer = await paced('sign-in', () =>
    api.send('POST', '/auth/tenants/northfield/sign-in', { json: { email, password } }),
  );
  await api.dispose();
  const problem = (answer.json ?? {}) as { title?: string; detail?: string };
  return { status: answer.status, title: problem.title, detail: problem.detail };
}

function moveTo(name: string, email: string): void {
  updateState((state) => {
    const found = state.people[name];
    if (found !== undefined) found.email = email;
  });
}

test.describe('changing the sign-in email address', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await createStaff(STAFF, 'programme_manager');
  });

  test.afterAll(async () => {
    await deleteMessagesTo(...used, person(STAFF).email);
  });

  test('@a11y a staff member changes it after step-up, and only the page’s button completes it', async ({
    pages,
  }) => {
    const old = person(STAFF).email;
    const next = addressFor('mail-manager-new');
    used.push(old, next);
    const admin = await signInStaff('northfield', 'colleague');
    const before = (await auditEvents(admin, { action: 'platform.auth.email_changed' })).length;

    const page = await pages.staff(STAFF);
    const urls = watchAddresses(page.context());
    // A second browser, signed in before the change.
    const other = await pages.staff(STAFF, 'northfield', true);
    await page.goto('/northfield/account/security');
    await expect(h1(page, 'Account security')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('textbox', { name: 'New email address' }).fill(next);
    await page.getByRole('button', { name: 'Change email address' }).click();
    await confirmIfAsked(
      page,
      STAFF,
      page.getByText('Check your email. If the address can be used, we have sent it a link'),
    );

    const link = await waitForLink(next, '/email-change');
    // A link scanner's GET changes nothing.
    const scanned = await page.request.get(link);
    expect(scanned.status()).toBeLessThan(500);
    expect((await signInAnswer(consoleOrigin, old, person(STAFF).password)).status).toBe(200);
    expect((await signInAnswer(consoleOrigin, next, person(STAFF).password)).status).not.toBe(200);

    await page.goto(link);
    await expect(h1(page, 'Confirm your new email address')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Confirm new email address' }).click();
    await expect(h1(page, 'Your email address has changed')).toBeVisible();
    await expectNoViolations(page);
    moveTo(STAFF, next);

    // This browser stays signed in; the other one is signed out.
    expect((await page.request.get('/api/auth/session')).ok()).toBe(true);
    expect((await other.request.get('/api/console/team')).status()).toBe(401);

    const notices = await waitForMessages(old);
    expect(notices.map(({ subject }) => subject).join('\n')).toMatch(
      /email address for your .* account was changed/i,
    );
    await expect
      .poll(
        async () => (await auditEvents(admin, { action: 'platform.auth.email_changed' })).length,
      )
      .toBe(before + 1);
    const text = JSON.stringify(
      await auditEvents(admin, { action: 'platform.auth.email_changed' }),
    );
    expect(text.includes(old) || text.includes(next), 'an address is in the event').toBe(false);
    await admin.dispose();
    expect(holdsAddress(urls), 'an email address was in a URL').toBe(false);
  });

  test('the new address signs in, and the old one is refused as an unknown address is', async () => {
    const { email, password } = person(STAFF);
    const api = await Api.open(consoleOrigin);
    const session = await paced('sign-in', () =>
      api.send('POST', '/auth/tenants/northfield/sign-in', { json: { email, password } }),
    );
    expect(session.status).toBe(200);
    await api.dispose();

    const unknown = await signInAnswer(consoleOrigin, addressFor('nobody'), password);
    const old = used[0] ?? '';
    const refused = await signInAnswer(consoleOrigin, old, password);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused).toEqual(unknown);
  });

  test('@a11y an applicant changes it, the profile shows the new address, and other sessions end', async ({
    pages,
  }) => {
    const applicant = await createApplicantAccount(APPLICANT);
    const old = person(APPLICANT).email;
    const next = addressFor('applicant-new');
    used.push(old, next);

    // The API session asks for the change; the browser, signed in as well, opens the link.
    await applicant.ok('POST', '/auth/step-up/password', {
      json: { password: person(APPLICANT).password },
    });
    await applicant.ok('POST', '/auth/account/email', { json: { email: next } });
    const page = await pages.applicant(APPLICANT);
    const urls = watchAddresses(page.context());

    const link = await waitForLink(next, '/email-change');
    expect((await page.request.get(link)).status()).toBeLessThan(500);
    expect((await signInAnswer(portalOrigin, old, person(APPLICANT).password)).status).toBe(200);

    await page.goto(link);
    await expect(h1(page, 'Confirm your new email address')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Confirm new email address' }).click();
    await expect(h1(page, 'Your email address has changed')).toBeVisible();
    await expectNoViolations(page);
    moveTo(APPLICANT, next);

    expect((await page.request.get('/api/auth/session')).ok()).toBe(true);
    expect((await applicant.send('GET', '/portal/profile')).status).toBe(401);
    await applicant.dispose();
    const notices = await waitForMessages(old);
    expect(notices.map(({ subject }) => subject).join('\n')).toMatch(
      /email address for your .* account was changed/i,
    );

    const refused = await signInAnswer(portalOrigin, old, person(APPLICANT).password);
    expect(refused).toEqual(
      await signInAnswer(portalOrigin, addressFor('nobody'), person(APPLICANT).password),
    );
    const fresh = await pages.applicant(APPLICANT);
    await fresh.goto('/northfield/');
    await fresh.getByRole('link', { name: 'Your details' }).click();
    await expect(fresh.getByRole('main').getByText(next, { exact: true })).toBeVisible();
    expect(holdsAddress(urls), 'an email address was in a URL').toBe(false);
  });
});
