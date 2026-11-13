// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reminders (ADR 0009, ADR 0020) through the whole API and the worker's jobs
// against the test database, for two tenants: the settings and history
// routes as app_api, and the scan and send jobs as app_worker in the
// payload's tenant. A reminder only reminds (rule 9): no application,
// assignment or decision changes, whatever is overdue.

import { randomUUID } from 'node:crypto';

import { withTenant } from '@pixel-scientists/db';
import { sendJob } from '@pixel-scientists/db/jobs';
import type {
  ReminderHistory,
  ReminderSetting,
  ReminderSettingAnswer,
} from '@pixel-scientists/grants/contracts';
import {
  scanReminders,
  sendReminder,
  type QueueReminder,
  type ReminderSendOutcome,
} from '@pixel-scientists/grants/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import { templateRow } from '../../../packages/db/test/grants/fixtures.ts';
import { asMigratorIn, insertRow, type TestTenant } from '../../../packages/db/test/tenants.ts';
import { reminderScanJob, reminderSendQueue } from '../src/reminders.ts';
import { startDecisionsApi, PORTAL, type DecisionsApi } from './decisions-api.ts';
import { switchModule } from './modules-on.ts';
import { reviewAnswers } from './assessment-api.ts';
import { answer, rowsOf, type Problem } from './programme-api.ts';
import { addMember, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

vi.setConfig({ testTimeout: 60_000 });

let t: DecisionsApi;

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeAll(async () => {
  t = await startDecisionsApi('41133');
  await t.rows("DELETE FROM pgboss.job WHERE name LIKE 'grants.reminder_%'");
}, 60_000);

afterAll(async () => {
  await t.rows("DELETE FROM pgboss.job WHERE name LIKE 'grants.reminder_%'");
  await t.close();
});

const rowsIn = <T extends object>(tenant: TestTenant, text: string, values: unknown[] = []) =>
  rowsOf<T>(tenant, text, values);

/** A round of `manager`'s tenant with a reminder template of each kind, as the migrator adds them. */
async function reminderRound(manager: Member = t.managerA) {
  const round = manager === t.managerA ? await t.reviewRound() : undefined;
  const { programmeId, round: made } = round?.open ?? (await t.openRound(manager));
  const tenant = manager.tenant;
  const template = (outcome: string, subject: string, body: string) =>
    asMigratorIn(tenant.id, (client) =>
      insertRow(
        client,
        'grants.email_template_version',
        templateRow(tenant, programmeId, { outcome, subject, body }),
      ),
    );
  return {
    round: round as NonNullable<typeof round>,
    roundId: made.id,
    draftTemplate: await template(
      'draft_closing',
      '{{round_title}} closes soon',
      [
        'Dear {{given_name}},',
        '',
        'Your application for {{round_title}} closes at {{closing_time}}. Submit it before then.',
        '',
        '{{portal_link}}',
      ].join('\n'),
    ),
    reviewTemplate: await template(
      'review_overdue',
      'Your review for {{round_title}}',
      ['Dear {{given_name}},', '', 'Your review for {{programme_title}} is waiting.'].join('\n'),
    ),
  };
}

type Reminders = Awaited<ReturnType<typeof reminderRound>>;

const settingBody = (r: Reminders, change: { draft?: object; review?: object } = {}) => ({
  draft: { enabled: true, daysBefore: [7, 1], templateId: r.draftTemplate, ...change.draft },
  review: {
    enabled: true,
    overdueAfterDays: 14,
    repeatEveryDays: 7,
    templateId: r.reviewTemplate,
    ...change.review,
  },
});

const settingPath = (roundId: string) => `/console/rounds/${roundId}/reminder-setting`;
const putSetting = (roundId: string, body: object, member: Member = t.managerA) =>
  t.send(member, 'PUT', settingPath(roundId), body);
const saved = (r: Reminders, change: { draft?: object; review?: object } = {}) =>
  answer<ReminderSetting>(putSetting(r.roundId, settingBody(r, change)));

/** A draft of tenant A's round, started by the applicant whose person has an address. */
async function draftOf(r: Reminders, applicant: Member = t.ann) {
  const draft = await t.aDraft(applicant, r.roundId);
  const email = `ada-${randomUUID()}@example.org`;
  await t.personOf(applicant, 'Ada', email);
  return { draft, email };
}

const closesOf = async (roundId: string) =>
  (
    await t.rows<{ closes_at: Date }>('SELECT closes_at FROM grants.round WHERE id = $1', [roundId])
  )[0]?.closes_at as Date;

/** A moment `days` before the round closes, `minutes` on from the time a reminder falls due. */
const beforeClosing = (closes: Date, days: number, minutes = 120) =>
  new Date(closes.getTime() - days * DAY + minutes * 60_000);

const queue: QueueReminder = async (tx, reminderEmailId) => {
  await sendJob(
    tx,
    reminderSendQueue,
    { reminderEmailId },
    { sender: t.jobs, requestId: randomUUID(), causingUserId: null },
    { singletonOn: ['reminderEmailId'] },
  );
};

const scan = (tenant: TestTenant, now: Date) =>
  withTenant(t.worker, trustedTenantId(tenant.id), (trx) => scanReminders(trx, now, queue));

const send = (
  tenant: TestTenant,
  reminderEmailId: string,
  now = new Date(),
): Promise<ReminderSendOutcome> =>
  withTenant(t.worker, trustedTenantId(tenant.id), (trx) =>
    sendReminder({ sender: t.mail.sender, portalOrigin: PORTAL })(trx, {
      reminderEmailId,
      requestId: randomUUID(),
      now,
    }),
  );

interface Outbox {
  id: string;
  kind: string;
  occurrence: number;
  status: string;
  outcome_code: string | null;
  recipient_person_id: string | null;
  application_id: string | null;
  assignment_id: string | null;
}

const outbox = (tenant: TestTenant, column: 'application_id' | 'assignment_id', id: string) =>
  rowsIn<Outbox>(
    tenant,
    `SELECT id, kind, occurrence, status, outcome_code, recipient_person_id, application_id, assignment_id
       FROM grants.reminder_email WHERE ${column} = $1 ORDER BY occurrence`,
    [id],
  );

const waiting = (ids: string[]) =>
  t.rows<{ id: string; data: Record<string, string | null> }>(
    `SELECT id, data FROM pgboss.job
      WHERE name = 'grants.reminder_send' AND state = 'created' AND data->>'reminderEmailId' = ANY($1)`,
    [ids],
  );

describe('saving a reminder setting', () => {
  it('reads none, saves one as the session’s member, and writes its version and audit event', async () => {
    const r = await reminderRound();
    expect(
      await answer<ReminderSettingAnswer>(t.send(t.managerA, 'GET', settingPath(r.roundId))),
    ).toEqual({
      setting: null,
    });

    const setting = await saved(r);
    expect(setting).toMatchObject({
      version: 1,
      draft: { enabled: true, daysBefore: [7, 1], templateId: r.draftTemplate },
      review: { enabled: true, overdueAfterDays: 14, repeatEveryDays: 7 },
    });
    expect(
      await answer<ReminderSettingAnswer>(t.send(t.managerA, 'GET', settingPath(r.roundId))),
    ).toEqual({
      setting,
    });

    const [row] = await t.rows<{ created_by: string; updated_by: string }>(
      'SELECT created_by, updated_by FROM grants.reminder_setting WHERE round_id = $1',
      [r.roundId],
    );
    expect(row).toEqual({
      created_by: t.managerA.membershipId,
      updated_by: t.managerA.membershipId,
    });
    const [version] = await t.rows<{
      version: number;
      author_id: string;
      diff: { changes: { path: string }[] };
    }>(
      `SELECT version, author_id, diff FROM app.config_version
        WHERE entity_type = 'grants.reminder_setting' AND entity_id = $1`,
      [r.roundId],
    );
    expect(version).toMatchObject({ version: 1, author_id: t.managerA.membershipId });
    expect(version?.diff.changes.map(({ path }) => path)).toContain('draft.daysBefore');
    const [event] = await t.events<{ actor_id: string; changes: object }>(
      'grants.reminder_setting.updated',
      [r.roundId],
    );
    expect(event?.actor_id).toBe(t.managerA.membershipId);
    expect(Object.keys(event?.changes ?? {})).toContain(
      'grants.reminder_setting.draft_days_before_1',
    );
    expect(JSON.stringify(event)).not.toMatch(/closes soon|Dear/);
  });

  it('writes nothing for a save that changes nothing, and the next version for one that does', async () => {
    const r = await reminderRound();
    await saved(r);
    expect((await saved(r)).version).toBe(1);
    expect((await saved(r, { draft: { daysBefore: [3] } })).version).toBe(2);

    const versions = await t.rows<{ version: number }>(
      `SELECT version FROM app.config_version
        WHERE entity_type = 'grants.reminder_setting' AND entity_id = $1 ORDER BY version`,
      [r.roundId],
    );
    expect(versions.map(({ version }) => version)).toEqual([1, 2]);
    expect(await t.events('grants.reminder_setting.updated', [r.roundId])).toHaveLength(2);
  });

  it('refuses a decision template, an unknown template and a bad body, and writes nothing', async () => {
    const r = await reminderRound();
    const [accepted] = await t.rows<{ id: string }>(
      `SELECT t.id FROM grants.email_template_version t JOIN grants.round r ON r.programme_id = t.programme_id
        WHERE r.id = $1 AND t.outcome = 'accepted'`,
      [r.roundId],
    );
    for (const draft of [
      { templateId: accepted?.id },
      { templateId: r.reviewTemplate },
      { templateId: randomUUID() },
    ]) {
      const problem = await answer<Problem>(putSetting(r.roundId, settingBody(r, { draft })), 400);
      expect(problem.detail).toBe('Choose a reminder template.');
    }
    for (const body of [
      { ...settingBody(r), createdBy: t.ada.membershipId },
      settingBody(r, { draft: { daysBefore: [] } }),
      settingBody(r, { draft: { daysBefore: [7, 7] } }),
      settingBody(r, { draft: { daysBefore: [1, 2, 3, 4] } }),
      settingBody(r, { review: { overdueAfterDays: 0 } }),
    ]) {
      expect((await putSetting(r.roundId, body)).statusCode).toBe(400);
    }
    expect(
      await t.rows('SELECT 1 FROM grants.reminder_setting WHERE round_id = $1', [r.roundId]),
    ).toEqual([]);
    expect(await t.events('grants.reminder_setting.updated', [r.roundId])).toEqual([]);
  });

  it('is refused to members without the permission, and answers 404 across tenants', async () => {
    const r = await reminderRound();
    expect((await t.send(t.reviewerA, 'GET', settingPath(r.roundId))).statusCode).toBe(403);
    expect((await putSetting(r.roundId, settingBody(r), t.reviewerA)).statusCode).toBe(403);
    expect((await t.send(undefined, 'GET', settingPath(r.roundId))).statusCode).toBe(401);

    const none = randomUUID();
    expectLooksMissing(
      await t.send(t.managerB, 'GET', settingPath(r.roundId)),
      await t.send(t.managerB, 'GET', settingPath(none)),
    );
    expectLooksMissing(
      await putSetting(r.roundId, settingBody(r), t.managerB),
      await putSetting(none, settingBody(r), t.managerB),
    );
    expect(
      await t.rows('SELECT 1 FROM grants.reminder_setting WHERE round_id = $1', [r.roundId]),
    ).toEqual([]);
  });

  it('answers 404 on every route while grants is off for the tenant', async () => {
    const r = await reminderRound();
    await switchModule(t.tenantA, 'grants', false);
    try {
      for (const [method, path] of [
        ['GET', settingPath(r.roundId)],
        ['PUT', settingPath(r.roundId)],
        ['GET', `/console/submissions/${randomUUID()}/reminders`],
        ['GET', `/console/assignments/${randomUUID()}/reminders`],
      ] as const) {
        const response = await t.send(
          t.managerA,
          method,
          path,
          method === 'PUT' ? settingBody(r) : undefined,
        );
        expect(response.statusCode, path).toBe(404);
      }
    } finally {
      await switchModule(t.tenantA, 'grants', true);
    }
  });
});

describe('the draft reminder', () => {
  it('is written once for a draft near its closing time, queued with ids only, and sent once', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7] } });
    const { draft, email } = await draftOf(r);
    const closes = await closesOf(r.roundId);

    await scan(t.tenantA, beforeClosing(closes, 7, -120));
    expect(await outbox(t.tenantA, 'application_id', draft.id)).toEqual([]);
    await scan(t.tenantA, beforeClosing(closes, 7));
    await scan(t.tenantA, beforeClosing(closes, 7, 180));

    const rows = await outbox(t.tenantA, 'application_id', draft.id);
    const [row] = rows;
    const [person] = await t.rows<{ applicant_person_id: string }>(
      'SELECT applicant_person_id FROM grants.application WHERE id = $1',
      [draft.id],
    );
    expect(rows).toHaveLength(1);
    expect(row).toMatchObject({
      kind: 'draft_closing',
      occurrence: 7,
      status: 'pending',
      recipient_person_id: person?.applicant_person_id,
    });
    const jobs = await waiting([row?.id ?? '']);
    expect(jobs).toHaveLength(1);
    const leaves = Object.values(jobs[0]?.data ?? {});
    expect(leaves.every((leaf) => leaf === null || UUID.test(leaf))).toBe(true);

    t.sent.length = 0;
    const now = beforeClosing(closes, 7, 240);
    expect(await send(t.tenantA, row?.id ?? '', now)).toBe('done');
    expect(await send(t.tenantA, row?.id ?? '', now)).toBe('done');
    const mine = t.sent.filter((message) => message.to === email);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subject).toMatch(/closes soon/);
    expect(mine[0]?.text).toMatch(/Dear Ada,.*closes at .* UK time on \d+ \w+ \d{4}\./s);
    expect(mine[0]?.text).toContain(PORTAL);
    expect((await outbox(t.tenantA, 'application_id', draft.id))[0]).toMatchObject({
      status: 'sent',
    });
  });

  it('sends only the nearest when several are due, and records the older ones as superseded', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7, 1] } });
    const { draft } = await draftOf(r);
    const closes = await closesOf(r.roundId);

    await scan(t.tenantA, beforeClosing(closes, 1));
    const rows = await outbox(t.tenantA, 'application_id', draft.id);
    expect(
      rows.map(({ occurrence, status, outcome_code }) => [occurrence, status, outcome_code]),
    ).toEqual([
      [1, 'pending', null],
      [7, 'skipped', 'superseded'],
    ]);
    expect(await waiting(rows.map(({ id }) => id))).toHaveLength(1);
  });

  it('leaves out an erased applicant’s draft, on every scan, and still reminds the others in the round', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7] } });
    const erased = await draftOf(r);
    const other = await draftOf(r, t.ben);
    const closes = await closesOf(r.roundId);
    const [person] = await t.rows<{ applicant_person_id: string }>(
      'SELECT applicant_person_id FROM grants.application WHERE id = $1',
      [erased.draft.id],
    );
    const personId = person?.applicant_person_id ?? '';
    await asMigratorIn(t.tenantA.id, async (client) => {
      await client.query(
        `UPDATE party.person SET given_name = NULL, family_name = NULL, phone = NULL,
                user_id = NULL, email = id::text || '@erased.invalid' WHERE id = $1`,
        [personId],
      );
      await client.query("UPDATE party.party SET status = 'erased' WHERE id = $1", [personId]);
    });

    t.sent.length = 0;
    await expect(scan(t.tenantA, beforeClosing(closes, 7))).resolves.toBe(1);
    await expect(scan(t.tenantA, beforeClosing(closes, 7, 180))).resolves.toBe(0);

    expect(await outbox(t.tenantA, 'application_id', erased.draft.id)).toEqual([]);
    const [row] = await outbox(t.tenantA, 'application_id', other.draft.id);
    expect(row).toMatchObject({ status: 'pending', occurrence: 7 });
    expect(await send(t.tenantA, row?.id ?? '', beforeClosing(closes, 7, 240))).toBe('done');
    expect(t.sent.map((message) => message.to)).toEqual([other.email]);
  });

  it('writes nothing for a closed round, a switched off setting, an off module or a submitted application', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7] } });
    const { draft } = await draftOf(r);
    const closes = await closesOf(r.roundId);
    const due = beforeClosing(closes, 7);

    await scan(t.tenantA, new Date(closes.getTime() + 1));
    await saved(r, { draft: { enabled: false } });
    await scan(t.tenantA, due);
    await saved(r, { draft: { enabled: true } });
    await switchModule(t.tenantA, 'grants', false);
    try {
      await scan(t.tenantA, due);
    } finally {
      await switchModule(t.tenantA, 'grants', true);
    }
    expect(await outbox(t.tenantA, 'application_id', draft.id)).toEqual([]);

    const submitted = await t.submission(r.round);
    await scan(t.tenantA, due);
    expect(await outbox(t.tenantA, 'application_id', submitted)).toEqual([]);
    expect(await outbox(t.tenantA, 'application_id', draft.id)).toHaveLength(1);
  });

  it('is skipped at send time when the draft was submitted, the setting switched off or the round closed', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7] } });
    const applicants = [t.ann, t.ben, await addMember(t.tenantA, 'portal', 'applicant')];
    const drafts = await Promise.all(applicants.map((member) => draftOf(r, member)));
    const one = drafts[0] as (typeof drafts)[number];
    const closes = await closesOf(r.roundId);
    const now = beforeClosing(closes, 7, 240);
    await scan(t.tenantA, beforeClosing(closes, 7));
    const rowOf = async (id: string) =>
      (await outbox(t.tenantA, 'application_id', id))[0] as Outbox;
    const ids = drafts.map(({ draft }) => draft.id);
    const rows = await Promise.all(ids.map(rowOf));

    const filled = await t.saved(t.ann, one.draft, reviewAnswers);
    await answer(t.submit(t.ann, filled));
    t.sent.length = 0;
    await send(t.tenantA, rows[0]?.id ?? '', now);
    await saved(r, { draft: { enabled: false } });
    await send(t.tenantA, rows[1]?.id ?? '', now);
    await saved(r, { draft: { enabled: true } });
    await send(t.tenantA, rows[2]?.id ?? '', new Date(closes.getTime() + 1));

    expect(t.sent).toEqual([]);
    expect(
      (await Promise.all(ids.map(rowOf))).map(({ status, outcome_code }) => [status, outcome_code]),
    ).toEqual([
      ['skipped', 'not_needed'],
      ['skipped', 'switched_off'],
      ['skipped', 'closed'],
    ]);
  });

  it('moves with a deadline extension', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7] } });
    const { draft } = await draftOf(r);
    const closes = await closesOf(r.roundId);
    const extended = new Date(closes.getTime() + 3 * DAY);
    await answer(
      t.send(t.managerA, 'POST', `/console/rounds/${r.roundId}/adjustments`, {
        kind: 'deadline_extension',
        organisationId: draft.organisation.id,
        reasonCode: 'access_needs',
        closesAt: extended.toISOString().slice(0, 16),
      }),
      201,
    );

    await scan(t.tenantA, beforeClosing(closes, 7));
    expect(await outbox(t.tenantA, 'application_id', draft.id)).toEqual([]);
    await scan(t.tenantA, beforeClosing(extended, 7));
    expect(await outbox(t.tenantA, 'application_id', draft.id)).toHaveLength(1);
  });
});

describe('the review reminder', () => {
  /** A round with an assignment for Grace, whose person has an address. */
  async function overdue() {
    const r = await reminderRound();
    const submissionId = await t.submission(r.round);
    await answer(t.pool(r.round.open, t.grace));
    await answer(t.assign(r.round.review.id, [submissionId], t.grace));
    const email = `grace-${randomUUID()}@example.org`;
    await t.personOf(t.grace, 'Grace', email);
    const assignmentId = (await t.assignmentsOf(submissionId)).get(t.grace.membershipId) as string;
    const [row] = await t.rows<{ created_at: Date }>(
      'SELECT created_at FROM grants.assignment WHERE id = $1',
      [assignmentId],
    );
    return { r, assignmentId, email, createdAt: row?.created_at as Date };
  }

  it('is written for an assignment past its delay, repeats at the interval, and goes to the reviewer’s person', async () => {
    const { r, assignmentId, email, createdAt } = await overdue();
    await saved(r);
    const after = (days: number) => new Date(createdAt.getTime() + days * DAY);

    await scan(t.tenantA, after(13));
    expect(await outbox(t.tenantA, 'assignment_id', assignmentId)).toEqual([]);
    await scan(t.tenantA, after(15));
    await scan(t.tenantA, after(16));
    await scan(t.tenantA, after(22));

    const rows = await outbox(t.tenantA, 'assignment_id', assignmentId);
    expect(rows.map(({ kind, occurrence }) => [kind, occurrence])).toEqual([
      ['review_overdue', 1],
      ['review_overdue', 2],
    ]);
    t.sent.length = 0;
    expect(await send(t.tenantA, rows[1]?.id ?? '', after(22))).toBe('done');
    const mine = t.sent.filter((message) => message.to === email);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.text).toContain('Dear Grace,');
    expect(mine[0]?.text).not.toMatch(/score|Need|Impact/i);
  });

  it('is skipped at send time when the reviewer is no longer an active member', async () => {
    const { r, assignmentId, email, createdAt } = await overdue();
    await saved(r);
    const now = new Date(createdAt.getTime() + 15 * DAY);
    await scan(t.tenantA, now);
    const [row] = await outbox(t.tenantA, 'assignment_id', assignmentId);

    const setStatus = (status: string) =>
      asMigratorIn(t.tenantA.id, (client) =>
        client.query('UPDATE app.membership SET status = $2 WHERE id = $1', [
          t.grace.membershipId,
          status,
        ]),
      );
    await setStatus('suspended');
    t.sent.length = 0;
    try {
      await send(t.tenantA, row?.id ?? '', now);
    } finally {
      await setStatus('active');
    }
    expect(t.sent.filter((message) => message.to === email)).toEqual([]);
    expect((await outbox(t.tenantA, 'assignment_id', assignmentId))[0]).toMatchObject({
      status: 'skipped',
      outcome_code: 'no_recipient',
    });
  });
});

describe('a failing mail server', () => {
  it('leaves the row waiting for a retry on a connection failure, and fails it with a code for another', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7] } });
    const { draft } = await draftOf(r);
    const closes = await closesOf(r.roundId);
    await scan(t.tenantA, beforeClosing(closes, 7));
    const [row] = await outbox(t.tenantA, 'application_id', draft.id);
    const now = beforeClosing(closes, 7, 240);

    try {
      t.sendWith(() => Promise.resolve({ sent: false, code: 'connection_failed' }));
      expect(await send(t.tenantA, row?.id ?? '', now)).toBe('retry');
      expect((await outbox(t.tenantA, 'application_id', draft.id))[0]?.status).toBe('pending');
      t.sendWith(() => Promise.resolve({ sent: false, code: 'rejected' }));
      expect(await send(t.tenantA, row?.id ?? '', now)).toBe('done');
    } finally {
      t.restore();
    }
    expect((await outbox(t.tenantA, 'application_id', draft.id))[0]).toMatchObject({
      status: 'failed',
      outcome_code: 'delivery_failed',
    });
  });
});

describe('the jobs as the worker runs them', () => {
  const context = () => ({ sender: t.jobs, requestId: randomUUID(), causingUserId: null });
  const runScan = (tenant: TestTenant, data: Record<string, unknown> = { slot: randomUUID() }) =>
    withTenant(t.worker, trustedTenantId(tenant.id), (trx) =>
      reminderScanJob().handler(trx, { id: randomUUID(), data, context: context() }),
    );

  it('read and write only the payload’s tenant, and a send for another tenant’s row finds nothing', async () => {
    const a = await reminderRound();
    const b = await reminderRound(t.managerB);
    await saved(a, { draft: { daysBefore: [30] } });
    await answer(
      putSetting(b.roundId, settingBody(b, { draft: { daysBefore: [30] } }), t.managerB),
    );
    const { draft: draftA } = await draftOf(a);
    const draftB = await t.aDraft(t.cat, b.roundId);

    await runScan(t.tenantA);
    expect(await outbox(t.tenantA, 'application_id', draftA.id)).toHaveLength(1);
    expect(await outbox(t.tenantB, 'application_id', draftB.id)).toEqual([]);

    await runScan(t.tenantB);
    const [rowA] = await outbox(t.tenantA, 'application_id', draftA.id);
    const [rowB] = await outbox(t.tenantB, 'application_id', draftB.id);
    expect(rowB).toMatchObject({ status: 'pending' });

    t.sent.length = 0;
    expect(await send(t.tenantA, rowB?.id ?? '')).toBe('missing');
    expect(await send(t.tenantB, rowA?.id ?? '')).toBe('missing');
    expect(t.sent).toEqual([]);
    expect((await outbox(t.tenantB, 'application_id', draftB.id))[0]).toMatchObject({
      status: 'pending',
    });
  });

  it('refuse a scan payload that names a tenant', async () => {
    await expect(
      runScan(t.tenantA, { slot: randomUUID(), tenantId: t.tenantB.id }),
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});

describe('reminders only remind (rule 9)', () => {
  it('leave every draft, assignment and decision unchanged, however late', async () => {
    const r = await reminderRound();
    await saved(r, { draft: { daysBefore: [7] } });
    const { draft } = await draftOf(r);
    const submissionId = await t.submission(r.round);
    await answer(t.pool(r.round.open, t.grace));
    await answer(t.assign(r.round.review.id, [submissionId], t.grace));
    await t.personOf(t.grace, 'Grace', `grace-${randomUUID()}@example.org`);
    const assignmentId = (await t.assignmentsOf(submissionId)).get(t.grace.membershipId) as string;
    const closes = await closesOf(r.roundId);

    const snapshot = () =>
      t.rows(
        `SELECT 'application' AS kind, to_jsonb(a) AS row FROM grants.application a WHERE a.round_id = $1
         UNION ALL SELECT 'assignment', to_jsonb(s) FROM grants.assignment s WHERE s.round_id = $1
         UNION ALL SELECT 'decision', to_jsonb(d) FROM grants.decision d
           JOIN grants.application a ON a.id = d.application_id WHERE a.round_id = $1
         ORDER BY 1, 2::text`,
        [r.roundId],
      );
    const before = await snapshot();
    expect(before.length).toBeGreaterThan(2);

    const later = new Date(closes.getTime() + 90 * DAY);
    await scan(t.tenantA, beforeClosing(closes, 7));
    await scan(t.tenantA, later);
    const rows = [
      ...(await outbox(t.tenantA, 'application_id', draft.id)),
      ...(await outbox(t.tenantA, 'assignment_id', assignmentId)),
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) await send(t.tenantA, row.id, later);

    expect(await snapshot()).toEqual(before);
  });
});

describe('the reminder history', () => {
  it('lists what happened to a submission’s and an assignment’s reminders, with no address or text', async () => {
    const r = await reminderRound();
    await saved(r);
    const { draft, email } = await draftOf(r);
    const closes = await closesOf(r.roundId);
    await scan(t.tenantA, beforeClosing(closes, 7));
    const [row] = await outbox(t.tenantA, 'application_id', draft.id);
    await send(t.tenantA, row?.id ?? '', beforeClosing(closes, 7, 240));

    const path = `/console/submissions/${draft.id}/reminders`;
    expect((await t.send(t.managerA, 'GET', path)).statusCode).toBe(404);
    await answer(t.submit(t.ann, await t.saved(t.ann, draft, reviewAnswers)));
    const history = await answer<ReminderHistory>(t.send(t.managerA, 'GET', path));
    expect(
      history.reminders.map(({ at, ...rest }) => ({ ...rest, iso: at.endsWith('Z') })),
    ).toEqual([{ kind: 'draft_closing', outcome: 'sent', reason: null, iso: true }]);
    expect(JSON.stringify(history)).not.toContain(email);
  });

  it('is empty for an assignment with none, is refused without the permission, and answers 404 across tenants', async () => {
    const r = await reminderRound();
    const submissionId = await t.submission(r.round);
    await answer(t.pool(r.round.open, t.grace));
    await answer(t.assign(r.round.review.id, [submissionId], t.grace));
    const assignmentId = (await t.assignmentsOf(submissionId)).get(t.grace.membershipId) as string;

    for (const path of [
      `/console/submissions/${submissionId}/reminders`,
      `/console/assignments/${assignmentId}/reminders`,
    ]) {
      expect(await answer<ReminderHistory>(t.send(t.managerA, 'GET', path))).toEqual({
        reminders: [],
      });
      expect((await t.send(t.reviewerA, 'GET', path)).statusCode, path).toBe(403);
      const other = path.replace(/[0-9a-f-]{36}/, randomUUID());
      expectLooksMissing(
        await t.send(t.managerB, 'GET', path),
        await t.send(t.managerB, 'GET', other),
      );
    }
  });
});
