// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Global search through the console. A term travels only in a POST body: it is
// never in an address, the history, the title, web storage or a cookie, before,
// during or after a result is opened, and Back returns to where the search
// began. The second funder finds nothing of the first funder's, a person
// without the search permission has no route, and a blind reviewer's results
// name no applicant or organisation. A person result writes its sensitive-read
// audit event.
//
// It reads what the journey left, so it runs after the journey.

import type { Page } from '@playwright/test';

import { signInApplicant, signInStaff, stepUp } from '../../support/api.ts';
import { groups } from '../../support/applications.ts';
import { auditEvents } from '../../support/audit.ts';
import { axePages } from '../../support/axe.ts';
import { readState } from '../../support/state.ts';
import { expect, inOrder, test } from '../../support/test.ts';
import { auditReader, needsJourney } from '../../triage/steps.ts';

inOrder();
needsJourney();

const INVENTED = 'qzx-fernhill';
const ORGANISATION = groups[0]?.organisation ?? 'Westgate Village Hall';

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search' });

/** Every search request, by method and query string, and any address that holds `term`. */
function watch(page: Page, term: string) {
  const searches: string[] = [];
  const leaks: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/console/search'))
      searches.push(`${request.method()} ${new URL(url).search}`);
    if (decodeURIComponent(url).toLowerCase().includes(term.toLowerCase())) leaks.push(url);
  });
  return { searches, leaks };
}

/** Where a term could be kept in the browser. */
async function holders(page: Page): Promise<string> {
  return page.evaluate(() =>
    [
      location.href,
      document.title,
      JSON.stringify(history.state),
      JSON.stringify(Object.keys(localStorage).map((key) => localStorage.getItem(key))),
      JSON.stringify(Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key))),
      document.cookie,
    ].join('\n'),
  );
}

test.describe('global search', () => {
  test('a term goes in a POST body and nowhere else, and Back returns to the start', async ({
    pages,
  }) => {
    const page = await pages.staff('manager');
    await page.goto('/northfield/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const start = page.url();

    for (const term of [ORGANISATION, INVENTED]) {
      const { searches, leaks } = watch(page, term);
      await searchBox(page).fill(term);
      await expect(page.getByRole('status').filter({ hasText: /result/ })).toBeVisible();
      expect(searches.length).toBeGreaterThan(0);
      for (const search of searches) expect(search).toBe('POST ');
      expect((await holders(page)).toLowerCase()).not.toContain(term.toLowerCase());

      if (term === ORGANISATION) {
        await page.getByRole('option').first().click();
        await expect(page).not.toHaveURL(start);
        expect((await holders(page)).toLowerCase()).not.toContain(term.toLowerCase());
        await page.goBack();
        await expect(page).toHaveURL(start);
      }
      expect(leaks, `the term ${term} reached an address`).toEqual([]);
    }
    await axePages(page, ['/northfield/']);
  });

  test('a term nothing matches finds no result', async ({ pages }) => {
    const page = await pages.staff('manager');
    await page.goto('/northfield/');
    await searchBox(page).fill(INVENTED);
    await expect(page.getByRole('status').filter({ hasText: /result/ })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(0);
  });

  test('the second funder finds nothing of the first funder’s', async () => {
    const east = await signInStaff('eastmoor', 'eastManager');
    for (const term of [ORGANISATION, groups[1]?.organisation ?? 'Brook Street', 'Okafor']) {
      const answer = await east.send('POST', '/console/search', { json: { term } });
      expect(answer.status, term).toBe(200);
      expect(answer.text, term).not.toContain(term);
    }
    await east.dispose();
  });

  test('a person without the search permission has no route', async () => {
    const applicant = await signInApplicant('northfield', 'applicant1');
    const answer = await applicant.send('POST', '/console/search', {
      json: { term: ORGANISATION },
    });
    expect([401, 403, 404]).toContain(answer.status);
    await applicant.dispose();
  });

  test('a blind reviewer’s results name no applicant or organisation', async () => {
    const reviewer = await signInStaff('northfield', 'reviewer1');
    const people = Object.values(readState().people).map(({ email }) => email);
    for (const group of groups) {
      for (const term of [group.organisation, group.familyName]) {
        const answer = await reviewer.send('POST', '/console/search', { json: { term } });
        expect(answer.status, term).toBe(200);
        for (const giveaway of [group.organisation, group.givenName, group.familyName, ...people]) {
          expect(answer.text, `${term} gave away ${giveaway}`).not.toContain(giveaway);
        }
      }
    }
    await reviewer.dispose();
  });

  test('a person result writes its sensitive-read audit event for staff, without the term', async () => {
    const manager = await signInStaff('northfield', 'manager');
    await stepUp(manager, 'manager');
    const reader = await auditReader();
    const before = (await auditEvents(reader, { action: 'party.person.viewed' })).length;

    const family = groups[0]?.familyName ?? 'Okafor';
    const answer = await manager.ok<{ groups: { module: string; results: { kind: string }[] }[] }>(
      'POST',
      '/console/search',
      { json: { term: family } },
    );
    const people = answer.groups
      .flatMap(({ results }) => results)
      .filter((r) => r.kind.includes('person'));
    expect(people.length, 'the search found no person').toBeGreaterThan(0);

    const after = await auditEvents(reader, { action: 'party.person.viewed' });
    expect(after.length).toBeGreaterThan(before);
    expect(JSON.stringify(after)).not.toContain(family);
    await Promise.all([manager.dispose(), reader.dispose()]);
  });
});
