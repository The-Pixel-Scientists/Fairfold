// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm in the all-tools funder (CRM-08): a programme manager finds a seeded pair
// of near-duplicate organisations, compares them without changing anything,
// puts one in a list, and merges them through the screen, with step-up and a
// double click. The merge happens once: one merge record, one
// `party.party.merged` event with the member as actor and ids only, and the list
// membership moves to the survivor. Searching never puts the term in a URL.
//
// The import wizard, and a pair made by it, wait for routes the API has not
// wired (see the fixme below). The pair here is the seed's own ("Brinkholt Arts
// Trust" and "The Brinkholt Arts Trust"), so the spec runs once on a fresh stack.

import type { Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { confirmIfAsked } from '../auth/people.ts';
import {
  asSlug,
  auditReader,
  jsonOf,
  call,
  confirmAgain,
  eventsAbout,
  expect,
  keyed,
  membershipOf,
  onWave1,
  signInAs,
  staffName,
  test,
} from './support.ts';

onWave1();

const slug = 'linnetford';
const TERM = 'Brinkholt Arts';

interface Party {
  state: 'current' | 'merged';
  survivorId?: string;
}

let manager: Api;
let reviewer: Api;
let reader: Api;
let pair: [string, string] = ['', ''];
let listId = '';
let missing: string | undefined;

const NOT_WIRED =
  'The stack answers 404 to the merge routes, which the API registers only with TPS_CRM_PREVIEW_SECRET; the stack settings (scripts/stack.ts, infra) do not set it. Owner: lead.';
const skipUnlessMerging = () => {
  test.skip(missing !== undefined, missing ?? '');
};

const organisation = (id: string) => call(manager, 'GET', `/console/crm/organisations/${id}`);
const mergesOf = async (id: string) =>
  (
    await jsonOf<{ records: { id: string; loserId: string; survivorId: string }[] }>(
      call(manager, 'GET', `/console/crm/parties/${id}/merges`),
    )
  ).records;

test.describe('crm: find, compare and merge two organisations', () => {
  test.beforeAll(async () => {
    manager = await signInAs(slug, 'programme_manager');
    reviewer = await signInAs(slug, 'reviewer');
    reader = await auditReader(slug);
  });

  test.afterAll(async () => {
    await Promise.all([manager.dispose(), reviewer.dispose(), reader.dispose()]);
  });

  test('a reviewer is denied every crm route the manager uses', async () => {
    for (const [method, path, json] of [
      ['POST', '/console/crm/search', { term: TERM }],
      ['POST', '/console/crm/duplicates/query', {}],
      ['GET', '/console/crm/lists', undefined],
    ] as const) {
      const answer = await call(reviewer, method, path, json);
      expect(answer.status, `${method} ${path}`).toBe(403);
    }
  });

  test('searching by name finds both records and keeps the term out of every URL', async ({
    pages,
  }) => {
    const found = (
      await jsonOf<{ results: { id: string; kind: string; label: string; status: string }[] }>(
        call(manager, 'POST', '/console/crm/search', { term: TERM, kinds: ['organisation'] }),
      )
    ).results.filter(({ status }) => status === 'active');
    expect(found.map(({ label }) => label).sort()).toEqual([
      'Brinkholt Arts Trust',
      'The Brinkholt Arts Trust',
    ]);
    const ids = found.map(({ id }) => id).sort();
    pair = [ids[0] ?? '', ids[1] ?? ''];
    for (const id of pair) expect((await organisation(id)).status).toBe(200);

    await confirmAgain(manager, slug, 'programme_manager');
    const preview = await call(manager, 'POST', '/console/crm/merges/preview', {
      loserId: pair[0],
      survivorId: pair[1],
      kind: 'organisation',
    });
    if (preview.status === 404) missing = NOT_WIRED;
    else expect(preview.status, preview.text.slice(0, 200)).toBe(200);

    const page = await pages.staff(staffName(slug, 'programme_manager'), asSlug(slug));
    const urls: string[] = [];
    page.on('request', (request) => urls.push(decodeURIComponent(request.url())));
    await page.goto(`/${slug}/crm`);
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill(TERM);
    await page.getByRole('button', { name: 'Search records' }).click();
    await expect(page.getByRole('link', { name: 'The Brinkholt Arts Trust' })).toBeVisible();
    expect(page.url()).not.toContain('Brinkholt');
    expect(urls.filter((url) => /brinkholt/i.test(url))).toEqual([]);
  });

  test('@a11y the pair is on the possible duplicates page, and a list holds one of them', async ({
    pages,
  }) => {
    const { pairs } = await jsonOf<{ pairs: { partyId: string; otherPartyId: string }[] }>(
      call(manager, 'POST', '/console/crm/duplicates/query', { kind: 'organisation' }),
    );
    expect(
      pairs.some(
        (candidate) =>
          [candidate.partyId, candidate.otherPartyId].sort().join() === [...pair].sort().join(),
      ),
    ).toBe(true);

    const list = await jsonOf<{ id: string }>(
      keyed(manager, 'POST', '/console/crm/lists', { name: 'Arts groups to merge' }),
      201,
    );
    listId = list.id;
    const loserCandidate = pair[0];
    const added = await jsonOf<{ changed: number }>(
      keyed(manager, 'POST', `/console/crm/lists/${listId}/members`, {
        partyIds: [loserCandidate],
      }),
    );
    expect(added.changed).toBe(1);

    const page = await pages.staff(staffName(slug, 'programme_manager'), asSlug(slug));
    await axePages(page, [`/${slug}/crm/duplicates`]);
    await expect(page.getByRole('link', { name: 'Compare records' }).first()).toBeVisible();
  });

  test('comparing the records changes nothing', async ({ pages }) => {
    skipUnlessMerging();
    const page = await pages.staff(staffName(slug, 'programme_manager'), asSlug(slug));
    await page.goto(`/${slug}/crm/duplicates/organisation/${pair[0]}/${pair[1]}`);
    await confirmIfAsked(
      page,
      staffName(slug, 'programme_manager'),
      page.getByRole('heading', { level: 1, name: 'Compare records' }),
    );
    await expect(page.getByRole('button', { name: 'Review merge of organisations' })).toBeVisible();

    for (const id of pair) {
      expect(await mergesOf(id)).toEqual([]);
      expect((await jsonOf<Party>(organisation(id))).state).toBe('current');
    }
  });

  test('confirming asks for step-up and merges once, even after a double click', async ({
    pages,
  }) => {
    skipUnlessMerging();
    const name = staffName(slug, 'programme_manager');
    const page = await pages.staff(name, asSlug(slug));
    await page.goto(`/${slug}/crm/duplicates/organisation/${pair[0]}/${pair[1]}`);
    await confirmIfAsked(
      page,
      name,
      page.getByRole('heading', { level: 1, name: 'Compare records' }),
    );
    await page.getByRole('button', { name: 'Review merge of organisations' }).click();

    const dialog = page.getByRole('dialog', { name: 'Merge organisations' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('moves');
    await dialog.getByRole('button', { name: 'Merge organisations' }).dblclick();
    await confirmIfAsked(page, name, page.getByRole('heading', { name: 'The records are merged' }));
    await expect(page.getByRole('heading', { name: 'The records are merged' })).toBeVisible();

    const records = [...(await mergesOf(pair[0])), ...(await mergesOf(pair[1]))];
    expect(new Set(records.map(({ id }) => id)).size).toBe(1);
  });

  test('afterwards the other record leads to the one kept, and the list membership has moved', async () => {
    skipUnlessMerging();
    const [record] = await mergesOf(pair[0]);
    expect(record, 'one merge record').toBeDefined();
    const { loserId, survivorId } = record ?? { loserId: '', survivorId: '' };
    expect(new Set([loserId, survivorId])).toEqual(new Set(pair));

    expect(await jsonOf<Party>(organisation(loserId))).toEqual({ state: 'merged', survivorId });
    expect((await jsonOf<Party>(organisation(survivorId))).state).toBe('current');

    const members = (
      await jsonOf<{ members: { partyId: string }[] }>(
        call(manager, 'GET', `/console/crm/lists/${listId}/members`),
      )
    ).members.map(({ partyId }) => partyId);
    expect(members).toEqual([survivorId]);
  });

  test('one merge event names the member and holds ids only', async () => {
    skipUnlessMerging();
    const [record] = await mergesOf(pair[0]);
    const loserId = record?.loserId ?? '';
    const memberId = await membershipOf(manager);

    const merged = await eventsAbout(reader, slug, 'party.party.merged', loserId);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.actor.membershipId).toBe(memberId);
    const confirmed = await eventsAbout(reader, slug, 'crm.merge.confirmed', record?.id ?? '');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.actor.membershipId).toBe(memberId);

    for (const event of [...merged, ...confirmed]) {
      expect(JSON.stringify(event)).not.toMatch(/brinkholt|arts trust|@/i);
    }
  });

  // The import wizard, and the pair it would create, wait for routes the API has not wired:
  // crm.ts registers no import route and no staff route creates a party. Owner: api-builder.
  test.fixme('a member imports a small CSV: the preview shows a row error that says how to fix it, and confirming creates two near-duplicate organisations', () => {
    // Upload the CSV, start the import, read the preview rows, confirm, then read each created party back through the audit log.
  });
});
