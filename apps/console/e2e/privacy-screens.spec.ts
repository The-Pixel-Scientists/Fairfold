// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy screens in a real browser, with the API's answers stubbed
// (privacy-api.ts) and synthetic people only: the request list and its clock
// in words, recording a request, the clock actions, export and erasure with
// step-up, the breach log and its 72-hour clock under a fixed clock, the DPIA
// register, records of processing and the consent audit. The `@a11y` specs
// run axe over each screen and dialog.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import { problem } from './auth-api.ts';
import type { Handler } from './auth-api.ts';
import { expectNoViolations } from './auth-axe.ts';
import {
  TODAY,
  breach,
  dpia,
  person,
  permissions,
  requests,
  rightsRequest,
  sentWith,
  STEP_UP_NEEDED,
  stubPrivacy,
  uid,
} from './privacy-api.ts';
import { confirmItsYou, h1 } from './team-steps.ts';

const HOME = '/northfield/privacy';
const screen = (view: string, id: string) => `${HOME}?view=${view}&id=${id}`;
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const ok = (body: unknown): Handler => ({ status: 200, body });

/** Each screen loads its code when first opened, which a busy machine can slow past five seconds. */
const slow = { timeout: 15_000 };

async function fixClock(page: Page, time = TODAY) {
  await page.clock.install({ time: new Date(time) });
}

test.describe('rights requests and the clock', () => {
  test('lists requests with each clock status in words, and filters them', async ({ page }) => {
    await fixClock(page);
    await stubPrivacy(page);
    await page.goto(HOME);

    await expect(h1(page, 'Data protection requests')).toBeVisible(slow);
    await expect(page.getByText('Due 12 January 2027 (8 days left)')).toBeVisible();
    await expect(page.getByText('Overdue by 3 days')).toBeVisible();
    await expect(
      page.getByText('Clock stopped: the due date is not known until it restarts'),
    ).toBeVisible();
    await expect(page.getByText('Extended to 12 March 2027')).toBeVisible();
    await expect(page.getByRole('row', { name: /Objection/ })).toContainText('Closed');

    const [filtered] = await Promise.all([
      page.waitForRequest((request) => request.url().includes('kind=erasure')),
      page.getByLabel('Kind').selectOption('erasure'),
    ]);
    expect(filtered.url()).toContain('/rights-requests?kind=erasure');
  });

  test('says what to do when there are no requests', async ({ page }) => {
    await stubPrivacy(
      page,
      {},
      { 'GET /console/rights-requests': ok({ requests: [], nextCursor: null }) },
    );
    await page.goto(HOME);

    await expect(page.getByRole('heading', { name: 'No requests yet' })).toBeVisible(slow);
    await expect(page.getByText(/record it here to start the clock/)).toBeVisible();
  });

  test('records a request with only the contract fields', async ({ page }) => {
    const stub = await stubPrivacy(
      page,
      {},
      { 'POST /console/rights-requests': { status: 201, body: rightsRequest(10) } },
    );
    await page.goto(HOME);
    await page.getByRole('button', { name: 'Record request' }).first().click();

    const form = dialog(page, 'Record request');
    await form.getByLabel("Person's record ID").fill(person.id);
    await form.getByLabel('Summary').fill('Asked for a copy of their data.');
    await form.getByRole('button', { name: 'Record request' }).click();
    await expect(form).toBeHidden();

    const body = sentWith(stub, 'POST /console/rights-requests')?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'channel',
      'identityCheck',
      'kind',
      'personId',
      'receivedAt',
      'summary',
    ]);
    expect(body).toMatchObject({
      personId: person.id,
      kind: 'access',
      channel: 'email',
      identityCheck: 'not_started',
    });
  });

  test('stops and restarts the clock, each with a reason', async ({ page }) => {
    await fixClock(page);
    let current = requests[0];
    const stub = await stubPrivacy(
      page,
      {},
      {
        [`GET /console/rights-requests/${uid(1)}`]: () => ({ status: 200, body: current }),
        [`POST /console/rights-requests/${uid(1)}/pause`]: () => {
          current = rightsRequest(1, {
            clock: { state: 'paused', dueOn: null },
            clockEvents: [
              {
                kind: 'paused',
                on: '2027-01-04',
                reason: 'identity_proof',
                membershipId: uid(2),
                recordedAt: '2027-01-04T10:00:00.000Z',
              },
            ],
          });
          return { status: 200, body: current };
        },
        [`POST /console/rights-requests/${uid(1)}/resume`]: () => {
          current = rightsRequest(1, { clock: { state: 'running', dueOn: '2027-01-15' } });
          return { status: 200, body: current };
        },
      },
    );
    await page.goto(screen('request', uid(1)));
    await expect(h1(page, 'Access request')).toBeVisible(slow);

    await page.getByRole('button', { name: 'Stop the clock' }).click();
    await dialog(page, 'Stop the clock').getByRole('button', { name: 'Stop the clock' }).click();
    await expect(
      page.getByText('Clock stopped on 4 January 2027: waiting for proof of identity'),
    ).toBeVisible();
    await expect(
      page.getByText('The due date is not known until the clock restarts.'),
    ).toBeVisible();
    expect(sentWith(stub, `POST /console/rights-requests/${uid(1)}/pause`)?.body).toEqual({
      on: '2027-01-04',
      reason: 'identity_proof',
    });

    await page.getByRole('button', { name: 'Restart the clock' }).click();
    await dialog(page, 'Restart the clock')
      .getByRole('button', { name: 'Restart the clock' })
      .click();
    await expect(page.getByText('Due 15 January 2027 (11 days left)')).toBeVisible();
    expect(sentWith(stub, `POST /console/rights-requests/${uid(1)}/resume`)?.body).toEqual({
      on: '2027-01-04',
      reason: 'information_received',
    });
  });

  test('shows the server refusal of a second extension in the error summary', async ({ page }) => {
    const message = 'This request has been extended once already, which is the limit.';
    const stub = await stubPrivacy(
      page,
      {},
      { [`POST /console/rights-requests/${uid(4)}/extension`]: problem(409, message) },
    );
    await page.goto(screen('request', uid(4)));
    await expect(h1(page, 'Portability request')).toBeVisible(slow);

    await page.getByRole('button', { name: 'Extend deadline' }).click();
    const form = dialog(page, 'Extend deadline');
    await form.getByRole('button', { name: 'Extend deadline' }).click();

    await expect(form.getByText(message).first()).toBeVisible();
    expect(sentWith(stub, `POST /console/rights-requests/${uid(4)}/extension`)?.body).toMatchObject(
      {
        months: 1,
        reason: 'complex',
      },
    );
  });
});

test.describe('export and erasure', () => {
  test('exports a person with step-up and an empty body, then offers the file', async ({
    page,
  }) => {
    let started = false;
    const stub = await stubPrivacy(
      page,
      {},
      {
        [`GET /console/rights-requests/${uid(1)}`]: () => ({
          status: 200,
          body: rightsRequest(1, { exportRequestId: started ? uid(700) : null }),
        }),
        [`POST /console/rights-requests/${uid(1)}/export`]: () => {
          if (!stub.recent) return problem(403, STEP_UP_NEEDED);
          started = true;
          return { status: 202, body: { requestId: uid(700) } };
        },
        [`GET /console/rights-requests/${uid(1)}/export`]: ok({
          id: uid(700),
          requestedAt: '2027-01-04T10:00:00.000Z',
          status: 'ready',
          fileId: uid(800),
          expiresAt: '2027-01-11T10:00:00.000Z',
        }),
      },
    );
    await page.goto(screen('request', uid(1)));
    await expect(h1(page, 'Access request')).toBeVisible(slow);
    await expect(page.getByText('Sam Taylor')).toBeVisible();

    await page.getByRole('button', { name: "Export this person's data" }).click();
    const form = dialog(page, "Export this person's data");
    await expect(form).toContainText('everything we hold about Sam Taylor');
    await expect(form).toContainText('including tools that are switched off');
    await form.getByRole('button', { name: "Export this person's data" }).click();
    await confirmItsYou(page, 'correct horse', '123456');

    const link = page.getByRole('link', { name: 'Download file' });
    await expect(link).toHaveAttribute('href', new RegExp(`/console/files/${uid(800)}$`));
    const sends = stub.sent.filter(
      ({ key }) => key === `POST /console/rights-requests/${uid(1)}/export`,
    );
    expect(sends).toHaveLength(2);
    for (const send of sends) expect(send.body).toBeUndefined();
  });

  test('erases a person only after the name is typed and step-up, sending confirm alone', async ({
    page,
  }) => {
    let started = false;
    const stub = await stubPrivacy(
      page,
      {},
      {
        [`GET /console/rights-requests/${uid(2)}`]: () => ({
          status: 200,
          body: rightsRequest(2, {
            kind: 'erasure',
            clock: { state: 'overdue', dueOn: '2027-01-01' },
            erasureRequestId: started ? uid(701) : null,
          }),
        }),
        [`POST /console/rights-requests/${uid(2)}/erasure`]: () => {
          if (!stub.recent) return problem(403, STEP_UP_NEEDED);
          started = true;
          return { status: 202, body: { requestId: uid(701) } };
        },
        [`GET /console/rights-requests/${uid(2)}/erasure`]: ok({
          id: uid(701),
          requestedAt: '2027-01-04T10:00:00.000Z',
          status: 'running',
        }),
      },
    );
    await page.goto(screen('request', uid(2)));
    await expect(h1(page, 'Erasure request')).toBeVisible(slow);
    await expect(page.getByText('Sam Taylor')).toBeVisible();

    await page.getByRole('button', { name: "Erase this person's data" }).click();
    const form = dialog(page, "Erase this person's data");
    await expect(form).toContainText('cannot be undone');
    const erase = form.getByRole('button', { name: "Erase Sam Taylor's data" });

    await form.getByLabel(/Type Sam Taylor to confirm/).fill('Sam');
    await erase.click();
    await expect(
      form.getByText('Type Sam Taylor exactly as shown to confirm.').first(),
    ).toBeVisible();
    expect(sentWith(stub, `POST /console/rights-requests/${uid(2)}/erasure`)).toBeUndefined();

    await form.getByLabel(/Type Sam Taylor to confirm/).fill('Sam Taylor');
    await erase.click();
    await confirmItsYou(page, 'correct horse', '123456');

    await expect(page.getByText('The erasure is in progress')).toBeVisible();
    const sends = stub.sent.filter(
      ({ key }) => key === `POST /console/rights-requests/${uid(2)}/erasure`,
    );
    expect(sends).toHaveLength(2);
    for (const send of sends) expect(send.body).toEqual({ confirm: true });
  });

  test('offers no erasure to a member without the erasure permission', async ({ page }) => {
    await stubPrivacy(page, {
      permissions: permissions.filter((name) => !name.endsWith('.erase')),
    });
    await page.goto(screen('request', uid(2)));
    await expect(h1(page, 'Erasure request')).toBeVisible(slow);

    await expect(page.getByRole('button', { name: "Export this person's data" })).toBeVisible();
    await expect(page.getByRole('button', { name: "Erase this person's data" })).toHaveCount(0);
  });
});

test.describe('breaches and the 72-hour clock', () => {
  test('records a breach and counts down, then says once that the deadline has passed', async ({
    page,
  }) => {
    await fixClock(page, '2026-12-07T15:30:00.000Z');
    let recorded = false;
    const stub = await stubPrivacy(
      page,
      {},
      {
        'GET /console/breaches': () => ({
          status: 200,
          body: {
            breaches: recorded
              ? [
                  {
                    id: uid(300),
                    becameAwareAt: '2026-12-06T15:15:00.000Z',
                    dataCategories: ['contact', 'health'],
                    specialCategory: true,
                    clock: breach().clock,
                    riskLevel: null,
                    icoNotified: false,
                  },
                ]
              : [],
            nextCursor: null,
          },
        }),
        'POST /console/breaches': () => {
          recorded = true;
          return { status: 201, body: breach() };
        },
        [`GET /console/breaches/${uid(300)}`]: ok(breach()),
      },
    );
    await page.goto(`${HOME}?view=breaches`);
    await expect(page.getByRole('heading', { name: 'No breaches recorded' })).toBeVisible(slow);

    await page.getByRole('button', { name: 'Record breach' }).first().click();
    const form = dialog(page, 'Record breach');
    await expect(form).toContainText('Nothing is sent to the ICO');
    await expect(form.getByRole('checkbox', { name: 'Health (special category)' })).toBeVisible();
    await form.getByLabel('What happened').fill('A spreadsheet went to the wrong address.');
    await form.getByRole('checkbox', { name: 'Contact details' }).check();
    await form.getByRole('checkbox', { name: 'Health (special category)' }).check();
    await form.getByRole('button', { name: 'Record breach' }).click();
    await expect(form).toBeHidden();

    expect(sentWith(stub, 'POST /console/breaches')?.body).toMatchObject({
      dataCategories: ['contact', 'health'],
      approximateSubjects: null,
      approximateRecords: null,
    });
    await expect(
      page.getByText('47 hours left to tell the ICO, by 3:15pm on 9 December 2026'),
    ).toBeVisible();

    await page.getByRole('link', { name: /3:15pm on 6 December 2026/ }).click();
    await expect(h1(page, 'Breach')).toBeVisible();
    await expect(
      page.getByText('47 hours left to tell the ICO, by 3:15pm on 9 December 2026'),
    ).toBeVisible();
    await expect(page.locator('[aria-live]').filter({ hasText: 'left to tell' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);

    await page.clock.fastForward(50 * 3_600_000);
    await expect(page.getByText('ICO deadline passed 2 hours ago')).toBeVisible();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'The 72-hour deadline to tell the ICO has passed.' }),
    ).toHaveCount(1);
  });

  test('refuses a late record of telling the ICO until there is a reason', async ({ page }) => {
    await fixClock(page, '2026-12-10T12:00:00.000Z');
    const reason =
      'The ICO was told more than 72 hours after you became aware. Choose why it was late.';
    const stub = await stubPrivacy(
      page,
      {},
      {
        [`GET /console/breaches/${uid(300)}`]: ok(breach()),
        [`POST /console/breaches/${uid(300)}/ico-notification`]: (body) => {
          const { lateReason, notifiedAt } = body as {
            lateReason: string | null;
            notifiedAt: string;
          };
          return lateReason === null
            ? problem(400, reason, [{ field: 'body.lateReason', message: reason }])
            : {
                status: 200,
                body: breach({
                  icoNotification: {
                    notifiedAt,
                    reference: 'ICO-2026-0042',
                    lateReason,
                    recordedByMembershipId: uid(2),
                    recordedAt: notifiedAt,
                  },
                }),
              };
        },
      },
    );
    await page.goto(screen('breach', uid(300)));
    await expect(page.getByText('ICO deadline passed')).toBeVisible(slow);

    await page.getByRole('button', { name: 'Record that we told the ICO' }).click();
    const form = dialog(page, 'Record that we told the ICO');
    await expect(form).toContainText('This software has not sent anything');
    await form.getByLabel('ICO reference').fill('ICO-2026-0042');
    await form.getByRole('button', { name: 'Record that we told the ICO' }).click();
    await expect(form.getByText(reason).first()).toBeVisible();

    await form.getByLabel('Why the ICO was told late').selectOption('still_investigating');
    await form.getByRole('button', { name: 'Record that we told the ICO' }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText(/reference ICO-2026-0042/)).toBeVisible();
    expect(
      sentWith(stub, `POST /console/breaches/${uid(300)}/ico-notification`)?.body,
    ).toMatchObject({ reference: 'ICO-2026-0042', lateReason: null });
  });
});

test.describe('DPIAs, records of processing and consent', () => {
  test('creates a DPIA and signs it off, with the signer left to the session', async ({ page }) => {
    let current = dpia();
    const stub = await stubPrivacy(
      page,
      {},
      {
        'GET /console/dpias': ok({ dpias: [], nextCursor: null }),
        'GET /console/processing-activities': ok({ activities: [], nextCursor: null }),
        'POST /console/dpias': { status: 201, body: current },
        [`GET /console/dpias/${uid(400)}`]: () => ({ status: 200, body: current }),
        [`POST /console/dpias/${uid(400)}/sign-off`]: () => {
          current = dpia({
            status: 'signed_off',
            signOff: {
              membershipId: uid(2),
              signedOffAt: '2027-01-04T10:05:00.000Z',
              reviewOn: '2028-01-04',
            },
          });
          return { status: 200, body: current };
        },
      },
    );
    await page.goto(`${HOME}?view=dpias`);
    await expect(page.getByRole('heading', { name: 'No DPIAs yet' })).toBeVisible(slow);

    await page.getByRole('link', { name: 'Start DPIA' }).first().click();
    await expect(h1(page, 'New DPIA')).toBeVisible();
    await page.getByLabel('Title').fill('Mailing list move');
    await page
      .getByRole('group', { name: /special category or criminal offence data/ })
      .getByRole('radio', { name: 'Yes' })
      .check();
    await page.getByRole('button', { name: 'Add risk' }).click();
    await page.getByLabel('The risk').fill('Emails could reach the wrong people.');
    await page.getByRole('button', { name: 'Save DPIA' }).click();

    await expect(h1(page, 'Mailing list move')).toBeVisible();
    const body = sentWith(stub, 'POST /console/dpias')?.body as {
      screening: Record<string, string>;
      risks: { id: string }[];
    };
    expect(body.screening).toEqual({ q_special: 'yes' });
    expect(body.risks[0]?.id).toMatch(/^r_[a-z0-9]+$/);
    expect(Object.keys(body).sort()).toEqual([
      'dpoAdvice',
      'processingActivityIds',
      'risks',
      'screening',
      'title',
    ]);

    await page.getByRole('button', { name: 'Sign off DPIA' }).click();
    const form = dialog(page, 'Sign off DPIA');
    await form.getByLabel('Review on').fill('2028-01-04');
    await form.getByRole('button', { name: 'Sign off DPIA' }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText(/Signed off at 10:05am on 4 January 2027/)).toBeVisible();
    expect(sentWith(stub, `POST /console/dpias/${uid(400)}/sign-off`)?.body).toEqual({
      reviewOn: '2028-01-04',
    });
  });

  test('keeps keyboard focus in the risks as they are added and removed', async ({ page }) => {
    await stubPrivacy(
      page,
      {},
      { 'GET /console/processing-activities': ok({ activities: [], nextCursor: null }) },
    );
    await page.goto(screen('dpia', 'new'));
    await expect(h1(page, 'New DPIA')).toBeVisible(slow);

    const add = page.getByRole('button', { name: 'Add risk' });
    await add.click();
    await expect(page.getByLabel('The risk')).toBeFocused();
    await add.click();
    await expect(page.getByLabel('The risk').nth(1)).toBeFocused();
    await add.click();

    await page.getByRole('button', { name: 'Remove risk 2' }).click();
    await expect(page.getByLabel('The risk')).toHaveCount(2);
    await expect(page.getByLabel('The risk').nth(1)).toBeFocused();

    await page.getByRole('button', { name: 'Remove risk 2' }).click();
    await expect(page.getByLabel('The risk')).toBeFocused();

    await page.getByRole('button', { name: 'Remove risk 1' }).click();
    await expect(add).toBeFocused();
  });

  test('shows the generated record read only, and saves a processor', async ({ page }) => {
    const stub = await stubPrivacy(page, {}, processingAnswers());
    await page.goto(`${HOME}?view=processing`);

    const record = page.getByRole('table', {
      name: 'Record of processing, one row for each table',
    });
    await expect(record).toContainText('party.person', slow);
    await expect(record).toContainText('Keep a master record of people');
    await expect(record).toContainText('Legitimate interests');
    await expect(record.getByRole('button')).toHaveCount(0);

    await page.getByRole('button', { name: 'Add processor' }).first().click();
    const form = dialog(page, 'Add processor');
    await form.getByLabel('Name').fill('Mailbox Ltd');
    await form.getByLabel('What they do for you').fill('Sends our email');
    await form.getByRole('button', { name: 'Save processor' }).click();
    await expect(form).toBeHidden();

    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Processor saved. The record of processing has a new version.' }),
    ).toBeVisible();
    expect(sentWith(stub, 'POST /console/processors')?.body).toEqual({
      name: 'Mailbox Ltd',
      service: 'Sends our email',
      countryCode: 'GB',
      contractSignedOn: null,
      transferSafeguard: null,
    });
  });

  test('shows a consent audit, newest first', async ({ page }) => {
    await stubPrivacy(page, {}, consentAnswers());
    await page.goto(screen('consent', person.id));

    await expect(h1(page, 'Consent history')).toBeVisible(slow);
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toContainText('Withdrew consent');
    await expect(rows.nth(1)).toContainText('15 November 2026');
    await expect(rows.nth(2)).toContainText('Gave consent');
    await expect(rows.nth(2)).toContainText('Future funding opportunities');
  });
});

test.describe('the tool being off', () => {
  test('shows the not-found page and makes no privacy request', async ({ page }) => {
    const stub = await stubPrivacy(page, { modules: ['grants'] });
    await page.goto(`${HOME}?view=breaches`);

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible(slow);
    expect(
      stub.sent.filter(({ key }) => /\/console\/(rights-requests|breaches|dpias)/.test(key)),
    ).toEqual([]);
  });
});

function processingAnswers(): Record<string, Handler> {
  return {
    'GET /console/records-of-processing': ok({
      generatedAt: '2027-01-04T06:00:00.000Z',
      tables: [
        {
          table: 'party.person',
          module: 'party',
          dataCategories: ['identity', 'contact'],
          sensitivity: 'personal',
          retention: { rule: 'until_erased', days: null },
          subjectPaths: ['party.person.id'],
          purpose: 'Keep a master record of people',
          legalBasis: 'legitimate_interests',
          processorIds: [],
        },
      ],
    }),
    'GET /console/processing-activities': ok({
      activities: [
        {
          id: uid(500),
          name: 'Funding mailing list',
          purpose: 'Tell people about new funds',
          legalBasis: 'consent',
          specialCategoryCondition: null,
          dataCategories: ['contact'],
          subjectCategories: ['applicants'],
          recipients: '',
          processorIds: [],
          transfersAbroad: '',
          retention: '',
          securityMeasures: '',
          updatedAt: '2027-01-02T09:00:00.000Z',
        },
      ],
      nextCursor: null,
    }),
    'GET /console/processors': ok({ processors: [], nextCursor: null }),
    'POST /console/processors': {
      status: 201,
      body: {
        id: uid(600),
        name: 'Mailbox Ltd',
        service: 'Sends our email',
        countryCode: 'GB',
        contractSignedOn: null,
        transferSafeguard: null,
        updatedAt: '2027-01-04T10:00:00.000Z',
      },
    },
  };
}

function consentAnswers(): Record<string, Handler> {
  const entry = (state: string, version: string, recordedAt: string) => ({
    purpose: 'future_funding',
    channel: 'email',
    state,
    privacyNoticeVersion: version,
    recordedAt,
  });
  return {
    [`GET /console/people/${person.id}/consent-history`]: ok({
      entries: [
        entry('given', '2026-10', '2026-10-01T09:00:00.000Z'),
        entry('withdrawn', '2026-11', '2026-11-15T10:30:00.000Z'),
      ],
    }),
  };
}

test.describe('accessibility', () => {
  test('@a11y the request list has no axe violations', async ({ page }) => {
    await fixClock(page);
    await stubPrivacy(page);
    await page.goto(HOME);
    await expect(page.getByText('Overdue by 3 days')).toBeVisible(slow);
    await expectNoViolations(page);
  });

  test('@a11y a request with the export dialog open has no axe violations', async ({ page }) => {
    await fixClock(page);
    await stubPrivacy(page);
    await page.goto(screen('request', uid(1)));
    await page.getByRole('button', { name: "Export this person's data" }).click();
    await expect(dialog(page, "Export this person's data")).toBeVisible(slow);
    await expectNoViolations(page);
  });

  test('@a11y a request with the erasure dialog open has no axe violations', async ({ page }) => {
    await fixClock(page);
    await stubPrivacy(page);
    await page.goto(screen('request', uid(2)));
    await page.getByRole('button', { name: "Erase this person's data" }).click();
    await expect(dialog(page, "Erase this person's data")).toBeVisible(slow);
    await expectNoViolations(page);
  });

  test('@a11y the breach detail has no axe violations', async ({ page }) => {
    await fixClock(page);
    await stubPrivacy(page, {}, { [`GET /console/breaches/${uid(300)}`]: ok(breach()) });
    await page.goto(screen('breach', uid(300)));
    await expect(h1(page, 'Breach')).toBeVisible(slow);
    await expectNoViolations(page);
  });

  test('@a11y the DPIA form has no axe violations', async ({ page }) => {
    await stubPrivacy(
      page,
      {},
      { 'GET /console/processing-activities': ok({ activities: [], nextCursor: null }) },
    );
    await page.goto(screen('dpia', 'new'));
    await expect(h1(page, 'New DPIA')).toBeVisible(slow);
    await page.getByRole('button', { name: 'Add risk' }).click();
    await expectNoViolations(page);
  });

  test('@a11y the records of processing have no axe violations', async ({ page }) => {
    await stubPrivacy(page, {}, processingAnswers());
    await page.goto(`${HOME}?view=processing`);
    await expect(
      page.getByRole('table', { name: 'Processing activities, one row for each activity' }),
    ).toBeVisible(slow);
    await expectNoViolations(page);
  });

  test('@a11y the consent audit has no axe violations', async ({ page }) => {
    await stubPrivacy(page, {}, consentAnswers());
    await page.goto(screen('consent', person.id));
    await expect(h1(page, 'Consent history')).toBeVisible(slow);
    await expectNoViolations(page);
  });
});
