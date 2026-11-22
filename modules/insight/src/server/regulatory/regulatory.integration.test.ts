// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The publication run handlers as app_api and the preparation job as
// app_worker, against the test database, for two tenants. Grants, the file
// store and the permission check are stand-ins that record what they were
// asked, with invented values a leak would be easy to find by.

import { randomUUID } from 'node:crypto';

import { isAuditAction, roles } from '@pixel-scientists/domain/platform';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { keptChanges } from '../../../../../packages/db/src/audit.ts';
import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import {
  insightAuditActions,
  insightRefusals,
  insightRoutes,
  publicationRunSchema,
  type PublicationKind,
} from '../../contracts/index.ts';
import type { InsightContext, Tx } from '../context.ts';
import { preparePublication, regulatoryHandlers } from './index.ts';
import type { PrepareJob } from './job.ts';
import { publicationRefusals } from './messages.ts';
import type { CommittedFigures, ThreeSixtyGivingBuild } from './sources.ts';

class Refused extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

/** The runs the request sent a job for, and who it sent them for. */
const sent: string[] = [];
const sentFor: { membershipId: string; requestId: string }[] = [];
const requestId = randomUUID();

const handlers = regulatoryHandlers({
  notFound: () => new Refused(404, 'Not found'),
  refuse: (status, detail) => new Refused(status, detail),
  sendPrepareJob: (_tx, runId, requester) => {
    sent.push(runId);
    sentFor.push(requester);
    return Promise.resolve();
  },
});

/** What the stand-ins answer, and what they were asked. */
let giving: ThreeSixtyGivingBuild;
let figures: CommittedFigures;
let allowed: boolean;
let storeFails: boolean;
let fileFor: () => Promise<string>;
const asked: string[] = [];

const marker = 'MARKER-RECIPIENT-NAME';
const preparing = preparePublication({
  sources: {
    threeSixtyGiving: () => {
      asked.push('three_sixty_giving');
      return Promise.resolve(giving);
    },
    committedFigures: () => {
      asked.push('figures');
      return Promise.resolve(figures);
    },
  },
  storeOutput: async () => {
    const id = await fileFor();
    if (storeFails) throw new Error(`The store failed for ${marker}.`);
    return id;
  },
  mayPrepare: () => Promise.resolve(allowed),
});

interface Staff {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly other: string;
}

let api: ReturnType<typeof createDatabase<unknown>>;
let worker: ReturnType<typeof createDatabase<unknown>>;
let a: Staff;
let b: Staff;

const connectApi = () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  return createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
};

const connectWorker = () => {
  const { host, port, database, password } = databaseSettings('app_worker', 4);
  return createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
};

const staff = async (): Promise<Staff> => {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant);
    const other = await addMember(client, tenant, ['analyst']);
    for (const module of ['grants', 'insight']) {
      await insertRow(client, 'app.tenant_module', {
        tenant_id: tenant.id,
        module,
        enabled: true,
        updated_by_kind: 'operator',
      });
    }
    return { tenant, member, other };
  });
};

const setModule = (who: Staff, module: string, enabled: boolean) =>
  asMigratorIn(who.tenant.id, (client) =>
    client.query('UPDATE app.tenant_module SET enabled = $2, updated_by = $3 WHERE module = $1', [
      module,
      enabled,
      who.member,
    ]),
  );

const query = <T>(who: Staff, sql: string, values: unknown[] = []) =>
  asMigratorIn(who.tenant.id, async (client) => (await client.query<T & object>(sql, values)).rows);

/** A clean file nothing links to, which a prepared run may name. */
const cleanFile = (who: Staff): Promise<string> =>
  asMigratorIn(who.tenant.id, async (client) => {
    const id = await insertRow(client, 'app.file', {
      tenant_id: who.tenant.id,
      name: 'output.pdf',
      content_type: 'application/pdf',
      size_bytes: 1,
      created_by: who.member,
    });
    await client.query(
      `UPDATE app.file SET scan_state = 'clean', sha256 = $2, storage_key = $3 WHERE id = $1`,
      [id, Buffer.alloc(32, 1), `clean/${who.tenant.id}/${id}`],
    );
    return id;
  });

interface Event {
  readonly action: string;
  readonly entityId: string;
  readonly changes?: Parameters<typeof keptChanges>[0];
}

/** An audit recorder that checks each event as the platform would. */
function recorder() {
  const events: Event[] = [];
  const record = (event: Event) => {
    expect(isAuditAction(event.action)).toBe(true);
    expect(insightAuditActions).toContain(event.action);
    keptChanges(event.changes ?? {});
    events.push(event);
    return Promise.resolve();
  };
  return { events, record };
}

/** A route handler called as `who`, in a transaction of its own. */
function call(who: Staff, name: keyof typeof handlers, input: object = {}) {
  const { events, record } = recorder();
  const context = { audit: { record }, membership: { id: who.member }, requestId };
  const run = () =>
    withTenant(api, trustedTenantId(who.tenant.id), (tx: Tx) =>
      (handlers[name] as (args: object) => Promise<unknown>)({
        tx,
        context: context as unknown as InsightContext,
        input,
      }),
    );
  return { run, events };
}

/** The job, run as the worker in `who`'s tenant for a run. */
function job(who: Staff, runId: string) {
  const { events, record } = recorder();
  const work: PrepareJob = { runId, audit: record };
  return {
    events,
    run: () => withTenant(worker, trustedTenantId(who.tenant.id), (tx) => preparing(tx, work)),
  };
}

const period = { periodStart: '2026-04-01', periodEnd: '2027-03-31' };

async function request(who: Staff, kind: PublicationKind = 'annual_return'): Promise<string> {
  const run = (await call(who, 'preparePublicationRun', { body: { kind, ...period } }).run()) as {
    id: string;
  };
  return run.id;
}

const stateOf = async (who: Staff, id: string) =>
  (
    await query<{ state: string; error_code: string | null; output_file_id: string | null }>(
      who,
      'SELECT state, error_code, output_file_id FROM insight.publication_run WHERE id = $1',
      [id],
    )
  )[0];

const figureRow = (change: object = {}) => ({
  programmeId: randomUUID(),
  programmeTitle: 'Programme one',
  recipient: 'institution',
  currency: 'GBP',
  count: 2,
  amountMinor: 123_456,
  ...change,
});

beforeAll(async () => {
  api = connectApi();
  worker = connectWorker();
  [a, b] = await Promise.all([staff(), staff()]);
}, 60_000);

afterAll(async () => {
  // Migration 0021's down refuses while a membership holds a wave 1 role, so
  // the round trip in packages/db/test/migrations.test.ts needs these gone.
  for (const who of [a, b]) {
    await asMigratorIn(who.tenant.id, (client) =>
      client.query("UPDATE app.membership SET roles = '{reviewer}' WHERE id = $1", [who.other]),
    );
  }
  await Promise.all([api.destroy(), worker.destroy()]);
});

beforeEach(() => {
  giving = {
    status: 'built',
    file: { grants: [{ id: 'g-1' }] },
    summary: { grants: 1, unverifiedRecipients: [] },
  };
  figures = { status: 'figures', rows: [figureRow()] };
  allowed = true;
  storeFails = false;
  fileFor = () => cleanFile(a);
  asked.length = 0;
  sent.length = 0;
  sentFor.length = 0;
});

describe('the routes', () => {
  it('are for the console, and no reviewer, applicant or data protection lead holds them', () => {
    const routes = [
      insightRoutes.listPublicationRuns,
      insightRoutes.preparePublicationRun,
      insightRoutes.getPublicationRun,
      insightRoutes.markPublicationRunSubmitted,
    ];
    for (const route of routes) {
      expect(route.audience).toBe('console');
      expect(route.permission).toBe('insight.publications.manage');
      for (const role of ['reviewer', 'applicant', 'data_protection_lead'] as const) {
        expect(roles[role].permissions as readonly string[]).not.toContain(route.permission);
      }
    }
  });

  it('take no member, tenant, time or state from the request', () => {
    expect('body' in insightRoutes.markPublicationRunSubmitted).toBe(false);
    expect(Object.keys(insightRoutes.preparePublicationRun.body.shape).sort()).toEqual([
      'kind',
      'periodEnd',
      'periodStart',
    ]);
  });
});

describe('preparing a run', () => {
  it('inserts a preparing run for the session member, audits it and sends one job with the run id', async () => {
    const prepare = call(a, 'preparePublicationRun', {
      body: { kind: 'sorp_grant_note', ...period },
    });
    const run = publicationRunSchema.parse(await prepare.run());

    expect(run).toMatchObject({
      kind: 'sorp_grant_note',
      ...period,
      state: 'preparing',
      outputFileId: null,
      errorCode: null,
      preparedByMembershipId: a.member,
      submittedByMembershipId: null,
    });
    expect(sent).toEqual([run.id]);
    expect(sentFor).toEqual([{ membershipId: a.member, requestId }]);
    expect(prepare.events).toEqual([
      {
        action: 'insight.publication_run.prepared',
        entityId: run.id,
        changes: {
          'insight.publication_run.kind': { after: 'sorp_grant_note' },
          'insight.publication_run.period_start': { after: period.periodStart },
          'insight.publication_run.period_end': { after: period.periodEnd },
          'insight.publication_run.state': { after: 'preparing' },
        },
      },
    ]);
    const list = (await call(a, 'listPublicationRuns').run()) as { runs: { id: string }[] };
    expect(list.runs[0]?.id).toBe(run.id);
  });

  it('is refused with the fixed needs-Grants problem when Grants is off, and reads and sends nothing', async () => {
    await setModule(a, 'grants', false);
    const count = () => query(a, 'SELECT count(*)::int AS n FROM insight.publication_run');
    const before = await count();
    try {
      const prepare = call(a, 'preparePublicationRun', {
        body: { kind: 'annual_return', ...period },
      });
      await expect(prepare.run()).rejects.toMatchObject({
        status: 409,
        message: publicationRefusals.needsGrants,
      });
      expect(prepare.events).toEqual([]);
      expect(sent).toEqual([]);
      expect(asked).toEqual([]);
      expect(await count()).toEqual(before);
    } finally {
      await setModule(a, 'grants', true);
    }
  });
});

describe('the preparation job', () => {
  it('prepares each kind from what grants answered, and audits it with no amount, name or count', async () => {
    for (const kind of ['three_sixty_giving', 'sorp_grant_note', 'annual_return'] as const) {
      const id = await request(a, kind);
      const file = await cleanFile(a);
      fileFor = () => Promise.resolve(file);
      const work = job(a, id);

      expect(await work.run()).toBe('done');

      expect(await stateOf(a, id)).toEqual({
        state: 'prepared',
        error_code: null,
        output_file_id: file,
      });
      expect(work.events).toMatchObject([
        {
          action: 'insight.publication_run.prepared',
          entityId: id,
          changes: { 'insight.publication_run.state': { after: 'prepared' } },
        },
      ]);
      expect(JSON.stringify(work.events)).not.toMatch(/123456|MARKER|Programme one/);
    }
    expect(asked).toEqual(['three_sixty_giving', 'figures', 'figures']);
  });

  it('does nothing for a finished run, so a redelivery changes nothing', async () => {
    const id = await request(a);
    await job(a, id).run();
    asked.length = 0;
    const again = job(a, id);

    expect(await again.run()).toBe('done');
    expect(asked).toEqual([]);
    expect(again.events).toEqual([]);
  });

  it.each([
    ['the requester may no longer prepare', 'not_allowed'],
    ['grants answers that it is off', 'grants_off'],
    ['grants answers rows that are not figures', 'invalid_figures'],
    ['the file cannot be stored', 'output_failed'],
  ] as const)('fails the run with a code, and no message, when %s', async (_reason, code) => {
    if (code === 'not_allowed') allowed = false;
    if (code === 'grants_off') figures = { status: 'grants_off' };
    if (code === 'invalid_figures')
      figures = { status: 'figures', rows: [figureRow({ name: marker })] };
    if (code === 'output_failed') storeFails = true;
    const id = await request(a);
    const work = job(a, id);

    expect(await work.run()).toBe('done');

    expect(await stateOf(a, id)).toEqual({
      state: 'failed',
      error_code: code,
      output_file_id: null,
    });
    expect(JSON.stringify(work.events)).not.toContain(marker);
    expect(work.events[0]).toMatchObject({
      changes: { 'insight.publication_run.error_code': { after: code } },
    });
  });

  it('fails with module_off, and reads nothing, when insight is switched off after the request', async () => {
    const id = await request(a);
    await setModule(a, 'insight', false);
    try {
      await job(a, id).run();
      expect(await stateOf(a, id)).toMatchObject({ state: 'failed', error_code: 'module_off' });
      expect(asked).toEqual([]);
    } finally {
      await setModule(a, 'insight', true);
    }
  });

  it('leaves the run to be marked submitted by a member, and keeps its preparer', async () => {
    const id = await request(a);
    await job(a, id).run();
    const [after] = await query<{ prepared_by: string; submitted_by: string | null }>(
      a,
      'SELECT prepared_by, submitted_by FROM insight.publication_run WHERE id = $1',
      [id],
    );
    expect(after).toEqual({ prepared_by: a.member, submitted_by: null });
  });
});

describe('marking a run submitted', () => {
  it('is refused for a run that is not prepared, with a plain problem', async () => {
    const id = await request(a);
    const mark = call(a, 'markPublicationRunSubmitted', { params: { runId: id } });

    await expect(mark.run()).rejects.toMatchObject({
      status: 409,
      message: insightRefusals.notPrepared,
    });
    expect(mark.events).toEqual([]);
    expect((await stateOf(a, id))?.state).toBe('preparing');
  });

  it('records the session member and the database time, audits it once, and refuses a second', async () => {
    const id = await request(a);
    await job(a, id).run();
    const mark = call({ ...a, member: a.other }, 'markPublicationRunSubmitted', {
      params: { runId: id },
    });
    const run = publicationRunSchema.parse(await mark.run());

    expect(run).toMatchObject({ state: 'submitted', submittedByMembershipId: a.other });
    expect(run.submittedAt).not.toBeNull();
    expect(mark.events).toMatchObject([
      {
        action: 'insight.publication_run.submitted',
        entityId: id,
        changes: { 'insight.publication_run.state': { after: 'submitted' } },
      },
    ]);
    await expect(
      call(a, 'markPublicationRunSubmitted', { params: { runId: id } }).run(),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('another tenant', () => {
  it('cannot read or mark tenant A’s run, and gets the same answer as for an unknown id', async () => {
    const id = await request(a);
    await job(a, id).run();

    for (const name of ['getPublicationRun', 'markPublicationRunSubmitted'] as const) {
      const foreign = call(b, name, { params: { runId: id } });
      const unknown = call(b, name, { params: { runId: randomUUID() } });
      await expect(foreign.run()).rejects.toMatchObject({ status: 404, message: 'Not found' });
      await expect(unknown.run()).rejects.toMatchObject({ status: 404, message: 'Not found' });
      expect(foreign.events).toEqual([]);
    }
    const list = (await call(b, 'listPublicationRuns').run()) as { runs: { id: string }[] };
    expect(list.runs.map((run) => run.id)).not.toContain(id);
    expect((await stateOf(a, id))?.state).toBe('prepared');
  });

  it('cannot run tenant A’s job, which reads no figures for it and changes nothing', async () => {
    const id = await request(a);
    const foreign = job(b, id);

    expect(await foreign.run()).toBe('missing');

    expect(asked).toEqual([]);
    expect(foreign.events).toEqual([]);
    expect((await stateOf(a, id))?.state).toBe('preparing');
  });

  it('keeps a run of its own with its own preparer', async () => {
    const id = await request(b);
    const [own] = await query<{ prepared_by: string }>(
      b,
      'SELECT prepared_by FROM insight.publication_run WHERE id = $1',
      [id],
    );
    expect(own?.prepared_by).toBe(b.member);
  });
});
