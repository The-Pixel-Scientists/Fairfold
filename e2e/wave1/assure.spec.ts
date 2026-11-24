// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure in the all-tools funder: a due diligence officer screens an
// organisation on demand, and a match is only ever advice (ADR 0031, rule 9).
// Before and after any decision the organisation is exactly as it was: nothing
// rejected, blocked, held or relabelled. A decision needs step-up, an outcome
// with a reason that fits it and a named member, and is read back as one audit
// event with ids and codes only.
//
// The wave1 seed cannot load the synthetic sanctions list: assure.reference_list
// and assure.sanctions_entry are written only by the list loader, which does not
// exist yet. So a run on the stack finds `no_list` and raises no match, and the
// tests that need a match skip, saying so. They run as soon as a list is loaded.

import { randomUUID } from 'node:crypto';

import type { Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import {
  ABSENT,
  asSlug,
  auditReader,
  jsonOf,
  call,
  confirmAgain,
  echoesNothing,
  eventsAbout,
  expect,
  forgedKeys,
  keyed,
  membershipOf,
  onWave1,
  signInAs,
  staffName,
  test,
} from './support.ts';

onWave1();

const slug = 'linnetford';
const NAME = 'Ravensholt Trading';

interface Run {
  id: string;
  partyId: string;
  status: string;
  matchesRaised: number;
}

interface Summary {
  id: string;
  partyId: string;
  status: string;
}

const NO_MATCH =
  'The stack has no sanctions list to screen against (the seed cannot load one: assure.reference_list is written only by a list loader that does not exist yet), so no match was raised. Owner: db-security with assure.';

let officer: Api;
let manager: Api;
let reviewer: Api;
let reader: Api;
let organisationId = '';
let before = '';
let match: Summary | undefined;

const record = async () =>
  (await call(manager, 'GET', `/console/crm/organisations/${organisationId}`)).text;

test.describe('assure: screening is advice, and a decision is a named person acting', () => {
  test.beforeAll(async () => {
    officer = await signInAs(slug, 'due_diligence_officer');
    manager = await signInAs(slug, 'programme_manager');
    reviewer = await signInAs(slug, 'reviewer');
    reader = await auditReader(slug);
  });

  test.afterAll(async () => {
    await Promise.all([officer.dispose(), manager.dispose(), reviewer.dispose(), reader.dispose()]);
  });

  test('only the officer may screen, and screening one organisation twice with one key makes one run', async () => {
    const { results } = await jsonOf<{ results: { id: string; label: string }[] }>(
      call(manager, 'POST', '/console/crm/search', { term: NAME, kinds: ['organisation'] }),
    );
    organisationId = results.find(({ label }) => label.startsWith(NAME))?.id ?? '';
    expect(organisationId).toMatch(/^[0-9a-f-]{36}$/);
    before = await record();

    for (const denied of [manager, reviewer]) {
      const answer = await keyed(
        denied,
        'POST',
        `/console/parties/${organisationId}/screening-runs`,
      );
      expect(answer.status).toBe(403);
    }

    const key = randomUUID();
    const path = `/console/parties/${organisationId}/screening-runs`;
    const first = await jsonOf<Run>(keyed(officer, 'POST', path, undefined, key), 201);
    const again = await keyed(officer, 'POST', path, undefined, key);
    expect(again.status).toBeLessThan(300);
    expect((again.json as Run).id).toBe(first.id);

    await expect
      .poll(
        async () =>
          (await jsonOf<Run>(call(officer, 'GET', `/console/screening-runs/${first.id}`))).status,
        { message: 'the screening job never left the queue', timeout: 90_000 },
      )
      .not.toBe('queued');
    const run = await jsonOf<Run>(call(officer, 'GET', `/console/screening-runs/${first.id}`));
    expect(run.partyId).toBe(organisationId);
    expect(['completed', 'stale_list', 'no_list']).toContain(run.status);

    const { matches } = await jsonOf<{ matches: Summary[] }>(
      call(officer, 'GET', '/console/screening-matches', undefined),
    );
    match = matches.find(({ partyId, status }) => partyId === organisationId && status === 'open');
    expect(await eventsAbout(reader, slug, 'assure.screening_run.started', first.id)).toHaveLength(
      1,
    );
  });

  test('rule 9: the run alone changes nothing about the organisation', async () => {
    expect(await record()).toBe(before);
  });

  test('@a11y a match page says the match is advisory', async ({ pages }) => {
    test.skip(match === undefined, NO_MATCH);
    const page = await pages.staff(staffName(slug, 'due_diligence_officer'), asSlug(slug));
    await axePages(page, [`/${slug}/assure/matches`, `/${slug}/assure/matches/${match?.id ?? ''}`]);
    await expect(page.getByText('This match is advisory')).toBeVisible();
    await page.getByRole('button', { name: /decision/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Record decision' });
    await expect(dialog).toContainText('This match is advisory');
  });

  test('a decision needs step-up, a reason that fits the outcome and refuses a forged decider', async () => {
    test.skip(match === undefined, NO_MATCH);
    const path = `/console/screening-matches/${match?.id ?? ''}/decisions`;
    const decision = { outcome: 'not_a_match', reason: 'different_name' };

    expect((await keyed(manager, 'POST', path, decision)).status).toBe(403);
    expect((await keyed(officer, 'POST', path, decision)).status).toBe(403);

    await confirmAgain(officer, slug, 'due_diligence_officer');
    const mismatched = await keyed(officer, 'POST', path, {
      outcome: 'not_a_match',
      reason: 'identity_confirmed',
    });
    expect(mismatched.status).toBe(400);
    for (const key of forgedKeys) {
      const forged = await keyed(officer, 'POST', path, { ...decision, [key]: ABSENT });
      expect(forged.status, key).toBe(400);
    }
    expect(
      (await call(officer, 'GET', `/console/screening-matches/${match?.id ?? ''}`)).status,
    ).toBe(200);
  });

  test('the decision names the member, is read back as an event of ids and codes, and changes nothing else', async () => {
    test.skip(match === undefined, NO_MATCH);
    const matchId = match?.id ?? '';
    const path = `/console/screening-matches/${matchId}/decisions`;
    const decided = await jsonOf<{ decidedBy: string; outcome: string; reason: string }>(
      keyed(officer, 'POST', path, { outcome: 'not_a_match', reason: 'different_name' }),
      201,
    );
    expect(decided).toMatchObject({ outcome: 'not_a_match', reason: 'different_name' });
    expect(decided.decidedBy).toBe(await membershipOf(officer));

    const events = await eventsAbout(reader, slug, 'assure.screening_match.decided', matchId);
    expect(events).toHaveLength(1);
    expect(events[0]?.actor.membershipId).toBe(await membershipOf(officer));
    expect(JSON.stringify(events[0])).not.toMatch(/ravensholt|@/i);
    expect(await record()).toBe(before);
  });

  test('a match that is not in the funder, or does not exist, answers 404 and echoes nothing', async () => {
    const answer = await call(officer, 'GET', `/console/screening-matches/${ABSENT}`);
    expect(answer.status).toBe(404);
    expect(echoesNothing(answer, ABSENT, slug)).toBe(true);
  });
});
