// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Equality monitoring answers against the test database, as app_api, for two
// tenants: the applicant's own read and withdrawal (through the handlers, as
// their routes are not registered until the audit log hides these events), that
// nothing else in grants shows an answer or that anyone answered, and the
// counts insight reads. The responses are seeded as the migrator, since
// answering needs the round's monitoring form (S12-15).

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant, type Transaction } from '@pixel-scientists/db';
import type { SubmissionPage } from '@pixel-scientists/grants/contracts';
import { monitoringCounts } from '@pixel-scientists/grants/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { monitoringHandlers } from '../../../modules/grants/src/server/monitoring/handlers.ts';
import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../packages/db/test/connect.ts';
import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { reviewAnswers, reviewFields } from './assessment-api.ts';
import { accepted, startDecisionsApi, type DecisionsApi } from './decisions-api.ts';
import { question } from './forms-api.ts';
import { switchModule } from './modules-on.ts';
import { answer } from './programme-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

/** An option no other test data contains, so a leak is easy to find. */
const MARKER = 'zz_marker_option';
const FREE_TEXT = 'FREE-TEXT-SECRET';

const group = question('f_group', 'single_choice', 'Your group', {
  options: [
    { value: MARKER, label: 'Marker' },
    { value: 'other_group', label: 'Another group' },
    { value: 'prefer_not_to_say', label: 'Prefer not to say' },
  ],
});

let t: DecisionsApi;
let counts: ReturnType<typeof createDatabase<unknown>>;

beforeAll(async () => {
  t = await startDecisionsApi('41082');
  const settings = databaseSettings('app_api', 2);
  counts = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_api',
    maxConnections: 2,
    applicationName: 'tps-db-tests',
  });
}, 60_000);

afterAll(async () => {
  await counts.destroy();
  await t.close();
});

/** A submission in a new round, with a monitoring response seeded on it. */
async function answered(answers: object = { f_group: MARKER }) {
  const round = await t.reviewRound({ fields: [...reviewFields, group] });
  const applicationId = await t.submission(round);
  const response = await responseOn(applicationId, answers);
  return { round, roundId: round.open.round.id, applicationId, response };
}

const responseOn = async (applicationId: string, answers: object, tenant = t.tenantA) =>
  (
    await asMigratorIn(tenant.id, async (client) =>
      client.query<{ id: string }>(
        `INSERT INTO grants.monitoring_response
           (tenant_id, round_id, application_id, form_version_id, answers, privacy_notice_version)
         SELECT tenant_id, round_id, id, form_version_id, $2::jsonb, '2026-11'
           FROM grants.application WHERE id = $1
         RETURNING id`,
        [applicationId, JSON.stringify(answers)],
      ),
    )
  ).rows[0]?.id ?? '';

const monitoringPath = (applicationId: string) =>
  `/portal/applications/${applicationId}/monitoring`;

const responses = (applicationId: string) =>
  t.rows('SELECT 1 FROM grants.monitoring_response WHERE application_id = $1', [applicationId]);

describe('the applicant’s own answers', () => {
  /** The handlers the routes will call, as `app_api` in a tenant, with the audit calls kept. */
  const handlers = monitoringHandlers({ notFound: () => new Error('not found') });
  const audited: { action: string; entityId: string; changes?: object }[] = [];
  const context = {
    audit: {
      record: (event: (typeof audited)[number]) => Promise.resolve(void audited.push(event)),
      read: (event: (typeof audited)[number]) => Promise.resolve(void audited.push(event)),
    },
  };
  const call = (
    tenant: { id: string },
    name: 'getMonitoringResponse' | 'withdrawMonitoringResponse',
    applicationId: string,
  ) =>
    withTenant(counts, trustedTenantId(tenant.id), (tx) =>
      handlers[name]({ tx, context, input: { params: { applicationId } } }),
    );

  it('has no route yet: both answer 404 until the audit log hides these events (ADR 0032)', async () => {
    const { applicationId } = await answered();
    const missing = await t.send(t.ann, 'GET', monitoringPath(randomUUID()));
    expectLooksMissing(await t.send(t.ann, 'GET', monitoringPath(applicationId)), missing);
    expect((await t.send(t.ann, 'DELETE', monitoringPath(applicationId))).statusCode).toBe(404);
    expect(await responses(applicationId)).toHaveLength(1);
  });

  it('reads them, and shows another tenant nothing', async () => {
    const { applicationId } = await answered();
    expect(await call(t.tenantA, 'getMonitoringResponse', applicationId)).toMatchObject({
      response: { answers: { f_group: MARKER }, privacyNoticeVersion: '2026-11' },
    });
    await expect(call(t.tenantB, 'getMonitoringResponse', applicationId)).rejects.toThrow(
      'not found',
    );
  });

  it('answers null when there is none, and 404 before the application is submitted', async () => {
    const round = await t.reviewRound({ fields: [...reviewFields, group] });
    const submitted = await t.submission(round);
    expect(await call(t.tenantA, 'getMonitoringResponse', submitted)).toEqual({ response: null });

    const draft = await t.aDraft(t.ben, round.open.round.id);
    await expect(call(t.tenantA, 'getMonitoringResponse', draft.id)).rejects.toThrow('not found');
    await expect(call(t.tenantA, 'withdrawMonitoringResponse', draft.id)).rejects.toThrow(
      'not found',
    );
  });

  it('withdraws them for good, leaving the application as it was, and audits it without an answer', async () => {
    const { applicationId } = await answered();
    const state = () =>
      t.rows<object>(
        'SELECT status, stage_id, answers, answers_version, submitted_at FROM grants.application WHERE id = $1',
        [applicationId],
      );
    const before = await state();

    await expect(call(t.tenantB, 'withdrawMonitoringResponse', applicationId)).rejects.toThrow(
      'not found',
    );
    expect(await responses(applicationId)).toHaveLength(1);

    await call(t.tenantA, 'withdrawMonitoringResponse', applicationId);
    expect(await responses(applicationId)).toHaveLength(0);
    await expect(call(t.tenantA, 'withdrawMonitoringResponse', applicationId)).rejects.toThrow(
      'not found',
    );
    expect(await state()).toEqual(before);
    const event = audited.find(
      ({ action, entityId }) =>
        action === 'grants.monitoring.withdrawn' && entityId === applicationId,
    );
    expect(event).toBeDefined();
    expect(JSON.stringify(event?.changes)).not.toContain(MARKER);
  });
});

describe('what staff and the exports show', () => {
  it('carries no answer and no sign that anyone answered, in any console route, export or warehouse row', async () => {
    const { roundId, applicationId, round } = await answered({
      f_group: MARKER,
      f_title: FREE_TEXT,
    });
    await t.recorded(applicationId, accepted());
    await answer(t.release(roundId));
    await answer(
      t.send(t.adminA, 'PUT', '/console/exports/360giving/publisher', {
        funderIdentifier: 'GB-CHC-7654321',
        funderName: 'Northfield Foundation',
        identifierPrefix: '360G-northfield',
      }),
    );

    const reads = [
      '/console/submissions',
      `/console/submissions/${applicationId}`,
      `/console/submissions/${applicationId}/adjustments`,
      `/console/submissions/${applicationId}/assignments`,
      `/console/rounds/${roundId}`,
      `/console/rounds/${roundId}/adjustments`,
      `/console/rounds/${roundId}/assisted-applications`,
      `/console/rounds/${roundId}/decisions`,
      `/console/rounds/${roundId}/form-versions`,
      `/console/exports/360giving?roundId=${roundId}`,
      '/console/warehouse/snapshot',
    ];
    for (const path of reads) {
      const response = await t.send(
        path.includes('warehouse') || path.includes('360') ? t.adminA : t.managerA,
        'GET',
        path,
      );
      expect(response.statusCode, `${path} ${response.body}`).toBe(200);
      // The form lists the options, so the answer shows as its key and value together.
      expect(response.body, path).not.toMatch(/"f_group":/);
      expect(response.body, path).not.toContain(FREE_TEXT);
      expect(response.body, path).not.toMatch(/monitoring|consent_given|answered/i);
    }
    const listed = await answer<SubmissionPage>(t.send(t.managerA, 'GET', '/console/submissions'));
    expect(listed.submissions.length).toBeGreaterThan(0);
    expect(round.review.id).toBeDefined();
  });
});

describe('the counts for insight', () => {
  /** Runs `work` in the tenant, as app_api, as a request's transaction would. */
  const inTenant = <T>(tenantId: string, work: (tx: Transaction<unknown>) => Promise<T>) =>
    withTenant(counts, trustedTenantId(tenantId), work);

  const closed = (roundId: string) =>
    t.changeRound(roundId, "closes_at = now() - interval '1 hour'");

  it('counts only rounds closed for monitoring, by field and option, with no id or free text', async () => {
    const first = await answered({ f_group: MARKER, f_title: FREE_TEXT });
    await responseOn(await t.submission(first.round), { f_group: MARKER });
    await responseOn(await t.submission(first.round), { f_group: 'prefer_not_to_say' });

    expect(await inTenant(t.tenantA.id, (tx) => monitoringCounts(tx, [first.roundId]))).toEqual({
      status: 'counted',
      rounds: [],
    });

    await closed(first.roundId);
    const result = await inTenant(t.tenantA.id, (tx) => monitoringCounts(tx, [first.roundId]));
    expect(result).toEqual({
      status: 'counted',
      rounds: [
        {
          roundId: first.roundId,
          responses: 3,
          questions: [
            {
              fieldId: 'f_group',
              options: [
                { value: MARKER, count: 2 },
                { value: 'other_group', count: 0 },
                { value: 'prefer_not_to_say', count: 1 },
              ],
            },
          ],
        },
      ],
    });
    const text = JSON.stringify(result);
    for (const id of [first.applicationId, first.response]) expect(text).not.toContain(id);
    expect(text).not.toContain(FREE_TEXT);
  });

  it('never counts another tenant’s responses', async () => {
    const mine = await answered();
    const theirs = await t.openRound(t.managerB, [...reviewFields, group]);
    const draft = await t.aDraft(t.cat, theirs.round.id);
    await answer(t.submit(t.cat, await t.saved(t.cat, draft, reviewAnswers)));
    await responseOn(draft.id, { f_group: MARKER }, t.tenantB);
    await closed(mine.roundId);
    await asMigratorIn(t.tenantB.id, (client) =>
      client.query("UPDATE grants.round SET closes_at = now() - interval '1 hour' WHERE id = $1", [
        theirs.round.id,
      ]),
    );

    const result = await inTenant(t.tenantA.id, (tx) =>
      monitoringCounts(tx, [mine.roundId, theirs.round.id]),
    );
    expect(result).toMatchObject({ status: 'counted' });
    expect('rounds' in result && result.rounds.map(({ roundId }) => roundId)).toEqual([
      mine.roundId,
    ]);
    expect('rounds' in result && result.rounds[0]?.responses).toBe(1);
  });

  it('answers grants_off, and reads no row, while the tenant has grants switched off', async () => {
    const { roundId } = await answered();
    await closed(roundId);
    await switchModule(t.tenantA, 'grants', false);
    try {
      expect(await inTenant(t.tenantA.id, (tx) => monitoringCounts(tx, [roundId]))).toEqual({
        status: 'grants_off',
      });
    } finally {
      await switchModule(t.tenantA, 'grants', true);
    }
  });
});
