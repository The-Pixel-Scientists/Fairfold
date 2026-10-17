// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant routes through the whole API against the test database, as
// app_api, for two tenants: which rounds an applicant sees, starting an
// application, and who may reach whose. Saving, eligibility, submitting and
// withdrawing are in applications-submit.integration.test.ts.

import { randomUUID } from 'node:crypto';

import type {
  Application,
  ApplicationList,
  OpenRoundDetail,
  OpenRoundList,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import {
  complete,
  inDays,
  startApplicationsApi,
  type ApplicationsApi,
} from './applications-api.ts';
import { title } from './forms-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { addMember, events } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi('41030');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const roundIds = async (member = t.ann) =>
  (await answer<OpenRoundList>(t.send(member, 'GET', '/portal/rounds'))).rounds.map(({ id }) => id);

describe('the rounds an applicant sees', () => {
  it('lists open rounds with their programme, closing soonest first', async () => {
    const later = await t.openRound(t.managerA, undefined, { round: { closesAt: inDays(20) } });
    const sooner = await t.openRound(t.managerA, undefined, { round: { closesAt: inDays(2) } });

    const { rounds } = await answer<OpenRoundList>(t.send(t.ann, 'GET', '/portal/rounds'));
    const ids = rounds.map(({ id }) => id);
    expect(ids.indexOf(sooner.round.id)).toBeLessThan(ids.indexOf(later.round.id));
    const listed = rounds.find(({ id }) => id === sooner.round.id);
    expect(listed).toMatchObject({
      title: 'Autumn 2026',
      programme: { id: sooner.programmeId, title: 'Community Spaces Fund' },
      awardMinimum: { amountMinor: 100_000, currency: 'GBP' },
    });
    expect(listed?.closesAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  });

  it('leaves out draft and closed programmes, rounds not open yet or closed, rounds with no published form, and other tenants', async () => {
    const draftProgramme = await t.openRound(t.managerA, undefined, {
      programme: { status: 'draft' },
    });
    const closedProgramme = await t.openRound(t.managerA, undefined, {
      programme: { status: 'closed' },
    });
    const notYet = await t.openRound(t.managerA, undefined, {
      round: { opensAt: inDays(2), closesAt: inDays(9) },
    });
    const closed = await t.openRound();
    await t.changeRound(closed.round.id, "closes_at = now() - interval '1 hour'");
    const noForm = await answer<{ id: string }>(
      t.send(t.managerA, 'POST', '/console/programmes', {
        title: 'No form',
        summary: 'Summary',
        description: 'Description',
        status: 'open',
      }),
      201,
    );
    const noFormRound = await t.aRound(noForm.id, { opensAt: inDays(-1), closesAt: inDays(5) });
    const otherTenant = await t.openRound(t.managerB);

    const ids = await roundIds();
    for (const { round } of [draftProgramme, closedProgramme, notYet, closed]) {
      expect(ids).not.toContain(round.id);
    }
    expect(ids).not.toContain(noFormRound.id);
    expect(ids).not.toContain(otherTenant.round.id);
    expect(await roundIds(t.cat)).toContain(otherTenant.round.id);
  });

  it('reads an open round with its published form, and answers any other round as missing', async () => {
    const open = await t.openRound();
    const detail = await answer<OpenRoundDetail>(
      t.send(t.ann, 'GET', `/portal/rounds/${open.round.id}`),
    );
    expect(detail.form.id).toBe(open.versionId);
    expect(detail.programme.description).toBe('Money for halls, gardens and workshops.');

    const missing = await t.send(t.ann, 'GET', `/portal/rounds/${randomUUID()}`);
    const closed = await t.openRound();
    await t.changeRound(closed.round.id, "closes_at = now() - interval '1 hour'");
    const draft = await t.openRound(t.managerA, undefined, { programme: { status: 'draft' } });
    const other = await t.openRound(t.managerB);
    for (const { round } of [closed, draft, other]) {
      expectLooksMissing(await t.send(t.ann, 'GET', `/portal/rounds/${round.id}`), missing);
    }
  });
});

describe('starting an application', () => {
  it('makes a draft for the applicant, on the latest published form, and audits it', async () => {
    const open = await t.openRound();
    const second = await answer<{ id: string }>(
      t.send(t.managerA, 'POST', `/console/rounds/${open.round.id}/form-versions`),
      201,
    );
    await answer(
      t.send(t.managerA, 'PUT', `/console/form-versions/${second.id}/definition`, {
        definition: { sections: [{ id: 's_about', title: 'About', fields: [title] }] },
      }),
    );
    await answer(t.send(t.managerA, 'POST', `/console/form-versions/${second.id}/publish`));

    const draft = await t.aDraft(t.ann, open.round.id);
    expect(draft).toMatchObject({
      status: 'in_progress',
      answers: {},
      answersVersion: 1,
      submittedAt: null,
      withdrawnAt: null,
      outcome: null,
      eligibility: { status: 'eligible' },
      organisation: { name: 'Northfield Allotment Society' },
      round: { id: open.round.id },
    });
    expect(draft.form.id).toBe(second.id);

    const [row] = await t.rows<{ applicant: string; user_id: string; created_by: string }>(
      `SELECT a.applicant_person_id AS applicant, p.user_id, a.created_by
         FROM grants.application a JOIN party.person p ON p.id = a.applicant_person_id
        WHERE a.id = $1`,
      [draft.id],
    );
    expect(row?.user_id).toBe(t.ann.userId);
    expect(row?.created_by).toBe(t.ann.membershipId);
    const [event] = (await events(t.tenantA, 'grants.application.created')).filter(
      ({ entity_id }) => entity_id === draft.id,
    );
    expect(event?.actor_id).toBe(t.ann.membershipId);
    expect(event?.changes).toMatchObject({
      'grants.application.form_version_id': { after: second.id },
      'grants.application.status': { after: 'draft' },
    });
  });

  it('finds or creates the person from the session', async () => {
    const open = await t.openRound();
    const fresh = await addMember(t.tenantA, 'portal', 'applicant');
    const before = await events(t.tenantA, 'party.person.created');
    await t.aDraft(fresh, open.round.id);
    const people = await t.rows(`SELECT 1 FROM party.person WHERE user_id = $1`, [fresh.userId]);
    expect(people).toHaveLength(1);
    expect(await events(t.tenantA, 'party.person.created')).toHaveLength(before.length + 1);
  });

  it('refuses an organisation the applicant is no contact for exactly as a missing one', async () => {
    const open = await t.openRound();
    const bens = await t.organisationOf(t.ben, 'Ben’s society');
    const catsInB = await t.organisationOf(t.cat);
    const missing = await t.send(t.ann, 'POST', t.startPath(open.round.id), {
      organisationId: randomUUID(),
    });
    for (const organisationId of [bens, catsInB]) {
      const refused = await t.send(t.ann, 'POST', t.startPath(open.round.id), { organisationId });
      expectLooksMissing(refused, missing);
    }
    expect(
      await t.rows(`SELECT 1 FROM grants.application WHERE organisation_id = $1`, [bens]),
    ).toHaveLength(0);
  });

  it('refuses a body that names the applicant, and a round that is not open', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const named = await t.send(t.ann, 'POST', t.startPath(open.round.id), {
      organisationId,
      applicantPersonId: randomUUID(),
    });
    expect(named.statusCode).toBe(400);

    const closed = await t.openRound();
    await t.changeRound(closed.round.id, "closes_at = now() - interval '1 hour'");
    const late = await t.send(t.ann, 'POST', t.startPath(closed.round.id), { organisationId });
    expectLooksMissing(
      late,
      await t.send(t.ann, 'POST', t.startPath(randomUUID()), { organisationId }),
    );
  });

  it('allows one live application for an organisation in a round', async () => {
    const open = await t.openRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    const again = await t.send(t.ann, 'POST', t.startPath(open.round.id), {
      organisationId: draft.organisation.id,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<Problem>().detail).toContain('already started');
    expect(
      await t.rows(`SELECT 1 FROM grants.application WHERE round_id = $1`, [open.round.id]),
    ).toHaveLength(1);
    const other = await t.aDraft(t.ben, open.round.id);
    expect(other.id).not.toBe(draft.id);
  });
});

describe("another applicant's applications", () => {
  it('read as missing on every route, in the tenant and from another tenant', async () => {
    const open = await t.openRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    const routes = t
      .everyRoute(open.round.id, draft.id)
      .filter(([, url]) => url.includes('/applications/'));
    expect(routes).toHaveLength(5);
    for (const stranger of [t.ben, t.cat]) {
      for (const [method, url, payload] of routes) {
        const outside = await t.send(stranger, method, url, payload);
        const gone = url.replace(draft.id, randomUUID());
        expectLooksMissing(outside, await t.send(stranger, method, gone, payload));
      }
    }
    const [row] = await t.rows<{ status: string }>(
      'SELECT status FROM grants.application WHERE id = $1',
      [draft.id],
    );
    expect(row?.status).toBe('draft');
  });

  it('keep each list to the caller’s own, the most recently changed first', async () => {
    const open = await t.openRound();
    const first = await t.aDraft(t.ann, open.round.id);
    const second = await t.aDraft(t.ann, open.round.id);
    await t.save(t.ann, first, complete);

    const mine = await answer<ApplicationList>(t.send(t.ann, 'GET', '/portal/applications'));
    const ids = mine.applications.map(({ id }) => id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    for (const stranger of [t.ben, t.cat]) {
      const theirs = await answer<ApplicationList>(t.send(stranger, 'GET', '/portal/applications'));
      expect(theirs.applications.map(({ id }) => id)).not.toContain(first.id);
    }
    const saved = await answer<Application>(t.send(t.ann, 'GET', t.path(first.id)));
    expect(saved.answersVersion).toBe(2);
  });
});

describe('who may use the routes', () => {
  it('refuse staff, a signed-out caller, and answer 404 for every route with grants off', async () => {
    const open = await t.openRound();
    const draft = await t.aDraft(t.ann, open.round.id);
    for (const [method, url, payload] of t.everyRoute(open.round.id, draft.id)) {
      expect((await t.send(t.managerA, method, url, payload, 'portal')).statusCode).toBe(403);
      expect((await t.send(undefined, method, url, payload)).statusCode).toBe(401);
    }

    const switchTo = (enabled: boolean) =>
      asMigratorIn(t.tenantA.id, (client) =>
        client
          .query(
            `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by)
             VALUES ($1, 'grants', $2, $3)
             ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled`,
            [t.tenantA.id, enabled, t.managerA.membershipId],
          )
          .then(() => undefined),
      );
    await switchTo(false);
    try {
      for (const [method, url, payload] of t.everyRoute(open.round.id, draft.id)) {
        expect((await t.send(t.ann, method, url, payload)).statusCode, url).toBe(404);
      }
    } finally {
      await switchTo(true);
    }
  });
});
