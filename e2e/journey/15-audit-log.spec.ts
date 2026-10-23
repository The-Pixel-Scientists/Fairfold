// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 15: the administrator reads the audit log for the round, filtered
// to Grants and the dates, and finds the release of decisions. Every state
// change of the steps before is in it, once for each change, and no event
// holds a name, an address or a file name.

import type { APIResponse } from '@playwright/test';

import {
  auditRows,
  filterToGrantsAndDates,
  findRelease,
  openAuditLog,
} from '../../apps/console/e2e/audit-log-steps.ts';
import { groups } from '../support/applications.ts';
import { eventsByAction, expectedEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { londonMoment } from '../support/clock.ts';
import { readState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

const day = (offset: number): string => {
  const { year, month, day: date } = londonMoment(offset, 12);
  return `${year}-${month.padStart(2, '0')}-${date.padStart(2, '0')}`;
};

test.describe('step 15: the administrator reads the audit log', () => {
  test('filters to Grants and the dates, and finds the release of decisions', async ({ pages }) => {
    const page = await pages.staff('admin');
    await page.goto('/northfield/');
    await openAuditLog(page);
    await filterToGrantsAndDates(page, day(-30), day(0));
    await expect(auditRows(page).first()).toBeVisible();
    await findRelease(page);
  });

  test('holds an event for every change the journey made, and nothing personal in them', async ({
    pages,
  }) => {
    const found = await eventsByAction(
      (await pages.staff('admin')).request,
      Object.keys(expectedEvents),
    );
    for (const [action, expected] of Object.entries(expectedEvents)) {
      const count = found.get(action)?.length ?? 0;
      if (typeof expected === 'number') expect(count, action).toBe(expected);
      else expect(count, action).toBeGreaterThanOrEqual(expected[0]);
    }

    // Every event says who acted and which record it was about, and holds no name, address or file name.
    const events = [...found.values()].flat();
    for (const event of events) {
      expect(event.entityId, event.action).toMatch(/^[0-9a-f-]{36}$/);
      expect(['staff', 'applicant', 'system', 'operator']).toContain(event.actor.kind);
    }
    const everything = JSON.stringify(events);
    const personal: string[] = [
      'Eastmere',
      'accounts-2026',
      'invoice-from-ada',
      ...groups.map(({ organisation }) => organisation),
      ...groups.map(({ givenName }) => givenName),
      ...Object.values(readState().people)
        .filter(({ email }) => /@example.org$/.test(email))
        .map(({ email }) => email),
    ];
    for (const value of personal) expect(everything, value).not.toContain(value);
  });

  // A funder's stylesheet change is kept in the log with an object as its value, which the log's
  // schema refuses, so the page that holds it answers 500 and the log cannot be read in full.
  test('reads the whole log, page by page', async ({ pages }) => {
    test.fail(true, 'GET /console/audit-events answers 500 for a page with a theme token change.');
    const admin = await pages.staff('admin');
    let cursor: string | null = null;
    let pagesRead = 0;
    do {
      const response: APIResponse = await admin.request.get(
        `/api/console/audit-events${cursor === null ? '' : `?cursor=${cursor}`}`,
      );
      expect(response.status(), `page ${String(pagesRead + 1)}`).toBe(200);
      cursor = ((await response.json()) as { nextCursor: string | null }).nextCursor;
      pagesRead += 1;
    } while (cursor !== null);
    expect(pagesRead).toBeGreaterThan(1);
  });

  test('@a11y the audit log has no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('admin'), ['/northfield/audit-log']);
  });
});
