// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Board packs against the test database (ADR 0009, "Jobs that act for a
// user"): the request and status handlers as app_api, and the job as
// app_worker in the tenant's transaction, for two tenants. The renderer and
// the output writer are stand-ins that keep what they are given: the real
// ones wait on S12-19 and S11-85. Applicant text here is invented and
// recognisable, so a test can show that none reaches an audit event.

import { randomUUID } from 'node:crypto';

import { createDatabase, withTenant } from '@pixel-scientists/db';
import { startJobSender, type JobSender } from '@pixel-scientists/db/jobs';
import { permissionsFor } from '@pixel-scientists/domain/platform';
import {
  boardPackRequestHandlers,
  makeBoardPack,
  replayBoardPack,
  type BoardPackDependencies,
  type BoardPackModel,
} from '@pixel-scientists/grants/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../packages/db/test/connect.ts';
import {
  addFile,
  addParts,
  applicationRow,
  submit,
} from '../../../packages/db/test/grants/application-fixtures.ts';
import { decisionRow, release } from '../../../packages/db/test/grants/decision-fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../../../packages/db/test/tenants.ts';
import { boardPackQueue, boardPackTemplates, queueBoardPack } from './board-packs.ts';
import { recordAudit } from './audit/writer.ts';

vi.setConfig({ testTimeout: 30_000 });

const FORM = {
  sections: [
    {
      id: 's_about',
      title: 'About',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Project name', classification: 'public' },
        {
          id: 'f_health',
          type: 'long_text',
          label: 'Access needs',
          classification: 'special_category',
          audiences: 'aggregate_only',
        },
      ],
    },
  ],
};
const NAME = 'Gwŷr Ŵyl hall roof';
const HEALTH = 'Step-free access for Ysgol Gymraeg';
const ADMIN = ['tenant_admin', 'programme_manager'];

class Refused extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Refused');
    this.status = status;
  }
}

interface Funder {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly colleague: string;
  readonly limited: string;
  readonly applications: readonly string[];
  readonly draft: string;
  readonly snapshotted: string;
  readonly manager: string;
}

type Db = ReturnType<typeof createDatabase<unknown>>;
let api: Db;
let worker: Db;
let sender: JobSender;
let a: Funder;
let b: Funder;

const stored: { model?: BoardPackModel; fieldIds?: readonly string[]; requesterId?: string }[] = [];
let renders = 0;
let fileFor: Record<string, string> = {};
let storeFails = false;

const deps: BoardPackDependencies = {
  notFound: () => new Refused(404),
  forbidden: () => new Refused(403),
  tenantTimeZone: () => Promise.resolve('Europe/London'),
  boardPackTemplates,
  queueBoardPack: (...args) => queueBoardPack(sender)(...args),
};
const handlers = boardPackRequestHandlers(deps);

const job = makeBoardPack({
  boardPackTemplates,
  tenantTimeZone: deps.tenantTimeZone,
  render: (model) => {
    renders += 1;
    stored.push({ model });
    return (async function* () {
      await Promise.resolve();
      yield new TextEncoder().encode('%PDF-1.7');
    })();
  },
  store: async (_tx, output) => {
    if (storeFails) throw new Error('Disk full for Gwŷr Ŵyl');
    const last = stored[stored.length - 1];
    if (last) {
      last.fieldIds = output.fieldIds;
      last.requesterId = output.requesterId;
    }
    const parts: Uint8Array[] = [];
    for await (const chunk of output.chunks) parts.push(chunk);
    expect(parts).not.toHaveLength(0);
    const file = fileFor[output.requesterId];
    if (file === undefined) throw new Error('The test made no output file.');
    return file;
  },
});

async function addFunder(): Promise<Funder> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant, ADMIN);
    const colleague = await addMember(client, tenant, ADMIN);
    const limited = await addMember(client, tenant, ['tenant_admin']);
    await insertRow(client, 'app.tenant_module', {
      tenant_id: tenant.id,
      module: 'grants',
      enabled: true,
      updated_by: member,
    });
    const apply = async (stage: boolean) => {
      const parts = await addParts(client, tenant);
      const form = await insertRow(client, 'grants.form_version', {
        tenant_id: tenant.id,
        round_id: parts.round,
        version: 2,
        status: 'published',
        definition: FORM,
        published_at: new Date(),
        published_by: parts.member,
      });
      const id = await insertRow(
        client,
        'grants.application',
        applicationRow(tenant, parts, {
          form_version_id: form,
          answers: JSON.stringify({ f_name: NAME, f_health: HEALTH }),
        }),
      );
      if (stage) await submit(client, id, parts.stages[1]);
      return { id, parts };
    };
    const first = await apply(true);
    const applications = [first.id, (await apply(true)).id];
    const draft = (await apply(false)).id;
    const second = await apply(true);
    const { rows: taken } = await client.query<{ id: string }>(
      'INSERT INTO party.organisation_snapshot (organisation_id, taken_by) VALUES ($1, $2) RETURNING id',
      [second.parts.organisation, second.parts.member],
    );
    await client.query(
      'UPDATE grants.application SET organisation_snapshot_id = $2 WHERE id = $1',
      [second.id, taken[0]?.id],
    );
    fileFor = { ...fileFor, [member]: await addFile(client, tenant, first.parts.member) };
    return {
      tenant,
      member,
      colleague,
      limited,
      applications,
      draft,
      snapshotted: second.id,
      manager: first.parts.member,
    };
  });
}

const contextOf = (funder: Funder, membership: string, roles: readonly string[] = ADMIN) => ({
  requestId: randomUUID(),
  session: { tenant: funder.tenant.id },
  membership: { id: membership, permissions: new Set(permissionsFor([...roles], 'console')) },
});

const inApi = <T>(funder: Funder, work: Parameters<typeof withTenant<unknown, T>>[2]) =>
  withTenant(api, trustedTenantId(funder.tenant.id), work);

const request = (
  funder: Funder,
  ids: readonly string[],
  member = funder.member,
  roles?: string[],
) =>
  inApi(funder, (tx) =>
    handlers.requestBoardPack({
      tx,
      context: contextOf(funder, member, roles),
      input: { body: { applicationIds: [...ids] } },
    }),
  );

const status = (funder: Funder, requestId: string, member = funder.member) =>
  inApi(funder, (tx) =>
    handlers.readBoardPack({
      tx,
      context: contextOf(funder, member),
      input: { params: { requestId } },
    }),
  );

const events: unknown[] = [];

const runJob = (funder: Funder, requestId: string) =>
  withTenant(worker, trustedTenantId(funder.tenant.id), (trx) => {
    const actor = { kind: 'job', jobId: randomUUID(), originMembershipId: funder.member } as const;
    return job(trx, {
      jobRequestId: requestId,
      audit: async (event) => {
        events.push(event);
        await recordAudit(trx, actor, event);
      },
    });
  });

const rows = <T>(funder: Funder, text: string, values: unknown[] = []) =>
  asMigratorIn(funder.tenant.id, async (client) => (await client.query(text, values)).rows as T[]);

const rejects = async (promise: Promise<unknown>, code: number) =>
  expect(promise).rejects.toMatchObject({ status: code });

beforeAll(async () => {
  const apiSettings = databaseSettings('app_api', 4);
  api = createDatabase<unknown>({
    host: apiSettings.host,
    port: apiSettings.port,
    database: apiSettings.database,
    password: apiSettings.password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-api-tests',
  });
  const workerSettings = databaseSettings('app_worker', 4);
  worker = createDatabase<unknown>({
    host: workerSettings.host,
    port: workerSettings.port,
    database: workerSettings.database,
    password: workerSettings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-api-tests',
  });
  sender = await startJobSender(api, () => undefined);
  a = await addFunder();
  b = await addFunder();
}, 60_000);

afterAll(async () => {
  await worker.destroy();
  await api.destroy();
});

describe('asking for a board pack', () => {
  it('writes the request, its audit event, the default template and one job in one go', async () => {
    const { requestId } = await request(a, a.applications);
    const [row] = await rows<{
      kind: string;
      requested_by: string;
      permission: string;
      field_ids: string[];
      output_sensitivity: string;
      filters: { applicationIds: string[]; templateVersionId: string };
    }>(a, 'SELECT * FROM app.job_request WHERE id = $1', [requestId]);
    expect(row).toMatchObject({
      kind: 'board_pack',
      requested_by: a.member,
      permission: 'grants.data.export',
      output_sensitivity: 'internal',
    });
    expect(Object.keys(row?.filters ?? {}).sort()).toEqual(['applicationIds', 'templateVersionId']);
    expect(row?.filters.applicationIds).toEqual([...a.applications]);
    expect(row?.field_ids).toEqual([
      'grants.programme.title',
      'grants.round.title',
      'grants.application.status',
      'grants.application.submitted_at',
    ]);

    const versions = await rows<{ id: string; version: number; kind: string; created_by: string }>(
      a,
      'SELECT id, version, kind, created_by FROM app.document_template_version',
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, kind: 'board_pack', created_by: a.member });
    expect(row?.filters.templateVersionId).toBe(versions[0]?.id);
    const [config] = await rows<{ entity_type: string; author_id: string }>(
      a,
      "SELECT entity_type, author_id FROM app.config_version WHERE entity_type = 'platform.document_template'",
    );
    expect(config).toEqual({ entity_type: 'platform.document_template', author_id: a.member });
    const actions = await rows<{ action: string; changes: unknown }>(
      a,
      "SELECT action, changes FROM app.audit_event WHERE action IN ('grants.board_pack.requested', 'platform.document_template.published')",
    );
    expect(actions.map((event) => event.action).sort()).toEqual([
      'grants.board_pack.requested',
      'platform.document_template.published',
    ]);
    expect(JSON.stringify(actions)).not.toContain(NAME);

    const queued = await rows<{ data: Record<string, unknown> }>(
      a,
      "SELECT data FROM pgboss.job WHERE name = $1 AND data ->> 'jobRequest' = $2",
      [boardPackQueue.name, requestId],
    );
    expect(queued).toHaveLength(1);
    expect(Object.keys(queued[0]?.data ?? {})).not.toContain('applicationIds');
  });

  it('uses the latest template version again rather than publishing another', async () => {
    await request(a, [a.applications[0] ?? '']);
    const versions = await rows(a, 'SELECT 1 FROM app.document_template_version');
    expect(versions).toHaveLength(1);
  });

  it('answers the same 404 for a draft, an unknown id and another tenant, and writes nothing', async () => {
    const before = await rows(a, 'SELECT 1 FROM app.job_request');
    const attempts = [
      [...a.applications, a.draft],
      [...a.applications, randomUUID()],
      [...a.applications, b.applications[0] ?? ''],
    ];
    for (const ids of attempts) await rejects(request(a, ids), 404);
    expect(await rows(a, 'SELECT 1 FROM app.job_request')).toHaveLength(before.length);
    expect(await rows(b, 'SELECT 1 FROM app.job_request')).toHaveLength(0);
  });

  it('leaves no request, event, template or job when it rolls back', async () => {
    const fresh = await addFunder();
    await expect(
      inApi(fresh, async (tx) => {
        await handlers.requestBoardPack({
          tx,
          context: contextOf(fresh, fresh.member),
          input: { body: { applicationIds: [...fresh.applications] } },
        });
        throw new Error('Rolled back');
      }),
    ).rejects.toThrow('Rolled back');
    for (const table of [
      'app.job_request',
      'app.document_template_version',
      'app.config_version',
    ]) {
      expect(await rows(fresh, `SELECT 1 FROM ${table}`)).toHaveLength(0);
    }
    expect(
      await rows(fresh, "SELECT 1 FROM app.audit_event WHERE action LIKE 'grants.board_pack%'"),
    ).toHaveLength(0);
  });

  it('refuses a member who cannot read applications, whatever they can export', async () => {
    await rejects(request(a, a.applications, a.limited, ['tenant_admin']), 403);
  });

  it('refuses a body with an extra key, or a template or field list in it', async () => {
    for (const extra of [{ templateVersionId: randomUUID() }, { fieldIds: ['f_name'] }]) {
      await rejects(
        inApi(a, (tx) =>
          handlers.requestBoardPack({
            tx,
            context: contextOf(a, a.member),
            input: { body: { applicationIds: [...a.applications], ...extra } },
          }),
        ),
        404,
      );
    }
  });

  it('replays a retry as the same request', async () => {
    const { requestId } = await request(a, [...a.applications].reverse());
    const again = await inApi(a, (tx) =>
      replayBoardPack(
        {
          tx,
          context: contextOf(a, a.member),
          input: { body: { applicationIds: [...a.applications] } },
        },
        deps,
      ),
    );
    expect(again).toEqual({ requestId });
  });
});

describe('reading a request', () => {
  it('is for the member who asked, and no one else, in any tenant', async () => {
    const { requestId } = await request(a, a.applications);
    expect(await status(a, requestId)).toMatchObject({ id: requestId, status: 'queued' });
    await rejects(status(a, requestId, a.colleague), 404);
    await rejects(status(b, requestId, b.member), 404);
    await rejects(status(a, randomUUID()), 404);
  });
});

describe('the job', () => {
  it('makes the pack as the requester sees it, classes it, audits it and changes no record', async () => {
    stored.length = 0;
    const { requestId } = await request(a, a.applications);
    const state = () =>
      rows(a, 'SELECT id, status, stage_id, answers FROM grants.application ORDER BY id');
    const before = JSON.stringify(await state());
    const decisionsBefore = await rows(a, 'SELECT * FROM grants.decision');

    expect(await runJob(a, requestId)).toBe('done');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.requesterId).toBe(a.member);
    expect(stored[0]?.model?.sections.map((section) => section.heading)).toEqual([
      'Application 1',
      'Application 2',
    ]);
    expect(JSON.stringify(stored[0]?.model)).not.toContain(HEALTH);
    expect(JSON.stringify(stored[0]?.model)).not.toContain(NAME);

    const ready = await status(a, requestId);
    expect(ready).toMatchObject({ status: 'ready', fileId: fileFor[a.member] });
    const [event] = await rows<{ changes: Record<string, unknown>; actor_kind: string }>(
      a,
      "SELECT changes, actor_kind FROM app.audit_event WHERE action = 'platform.document.generated' AND entity_id = $1",
      [requestId],
    );
    expect(event?.actor_kind).toBe('system');
    expect(Object.keys(event?.changes ?? {}).sort()).toEqual([
      'app.document_template_version.id',
      'app.file.id',
      'grants.application.id',
    ]);
    expect(JSON.stringify(event)).not.toMatch(/Gwŷr|Ysgol|Community|Spring/);

    expect(JSON.stringify(await state())).toBe(before);
    expect(await rows(a, 'SELECT * FROM grants.decision')).toEqual(decisionsBefore);
  });

  it('reads the organisation as submitted for staff, as the worker role, and no query is denied', async () => {
    stored.length = 0;
    const { requestId } = await request(a, [a.snapshotted]);
    expect(await runJob(a, requestId)).toBe('done');
    expect(await status(a, requestId)).toMatchObject({ status: 'ready' });
    expect(JSON.stringify(stored[0]?.model)).toContain('Northfield Allotment Society');
    const [row] = await rows<{ status: string; failure_code: string | null }>(
      a,
      'SELECT status, failure_code FROM app.job_request WHERE id = $1',
      [requestId],
    );
    expect(row).toEqual({ status: 'ready', failure_code: null });
  });

  it('does nothing for a request that is no longer queued, so a second delivery makes no second pack', async () => {
    const { requestId } = await request(a, a.applications);
    await runJob(a, requestId);
    const made = renders;
    expect(await runJob(a, requestId)).toBe('done');
    expect(renders).toBe(made);
  });

  it('fails with a code, an event and no file when the requester has lost the permission', async () => {
    const { requestId } = await request(a, a.applications, a.colleague);
    await asMigratorIn(a.tenant.id, (client) =>
      client.query("UPDATE app.membership SET roles = ARRAY['applicant'] WHERE id = $1", [
        a.colleague,
      ]),
    );
    const made = renders;
    expect(await runJob(a, requestId)).toBe('done');
    expect(renders).toBe(made);
    expect(await status(a, requestId, a.colleague)).toMatchObject({
      status: 'failed',
      failureCode: 'precondition_failed',
    });
    const [row] = await rows<{ output_file_id: string | null }>(
      a,
      'SELECT output_file_id FROM app.job_request WHERE id = $1',
      [requestId],
    );
    expect(row?.output_file_id).toBeNull();
    const [event] = await rows<{ changes: unknown }>(
      a,
      "SELECT changes FROM app.audit_event WHERE action = 'platform.document.generated' AND entity_id = $1",
      [requestId],
    );
    expect(event?.changes).toEqual({
      'app.job_request.failure_code': { after: 'precondition_failed' },
    });
  });

  it('fails rather than widen the pack when the data now allows a field the request did not', async () => {
    const { requestId } = await request(b, b.applications);
    await asMigratorIn(b.tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'grants.decision',
        decisionRow(
          b.tenant,
          {
            parts: {} as never,
            application: b.applications[0] ?? '',
            programme: '',
            manager: b.member,
          },
          { recorded_by: b.member },
        ),
      );
      await release(client, id, b.member);
    });
    const made = renders;
    await runJob(b, requestId);
    expect(renders).toBe(made);
    expect(await status(b, requestId)).toMatchObject({
      status: 'failed',
      failureCode: 'precondition_failed',
    });
  });

  it('ends failed with a code only, and no file, when the renderer or writer fails', async () => {
    const { requestId } = await request(a, a.applications);
    storeFails = true;
    try {
      expect(await runJob(a, requestId)).toBe('done');
    } finally {
      storeFails = false;
    }
    expect(await status(a, requestId)).toMatchObject({ status: 'failed', failureCode: 'internal' });
    const [event] = await rows<{ changes: unknown }>(
      a,
      "SELECT changes FROM app.audit_event WHERE action = 'platform.document.generated' AND entity_id = $1",
      [requestId],
    );
    expect(event?.changes).toEqual({ 'app.job_request.failure_code': { after: 'internal' } });
    expect(JSON.stringify(event)).not.toContain('Disk full for Gwŷr');
  });

  it('does nothing in another tenant, and nothing while grants is off', async () => {
    const { requestId } = await request(a, a.applications);
    expect(await runJob(b, requestId)).toBe('missing');
    await asMigratorIn(a.tenant.id, (client) =>
      client.query("UPDATE app.tenant_module SET enabled = false WHERE module = 'grants'"),
    );
    const made = renders;
    expect(await runJob(a, requestId)).toBe('done');
    expect(renders).toBe(made);
    expect(await status(a, requestId)).toMatchObject({ status: 'queued' });
    await asMigratorIn(a.tenant.id, (client) =>
      client.query("UPDATE app.tenant_module SET enabled = true WHERE module = 'grants'"),
    );
  });

  it('refuses an expired output on the status route before the expiry job runs', async () => {
    const { requestId } = await request(a, a.applications);
    await runJob(a, requestId);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * 24 * 60 * 60 * 1000 });
    try {
      expect(await status(a, requestId)).toMatchObject({ id: requestId, status: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('template versions', () => {
  it('are published once for a tenant even when requests arrive together', async () => {
    const fresh = await addFunder();
    await Promise.all([
      request(fresh, fresh.applications),
      request(fresh, fresh.applications, fresh.colleague),
      request(fresh, fresh.applications),
    ]);
    expect(await rows(fresh, 'SELECT 1 FROM app.document_template_version')).toHaveLength(1);
    expect(
      await rows(
        fresh,
        "SELECT 1 FROM app.config_version WHERE entity_type = 'platform.document_template'",
      ),
    ).toHaveLength(1);
  });

  it('are never changed or removed, and are read inside their own tenant', async () => {
    const [version] = await rows<{ id: string }>(a, 'SELECT id FROM app.document_template_version');
    const id = version?.id ?? '';
    await expect(
      inApi(a, (tx) => boardPackTemplates.byId(tx, id).then((found) => found?.version)),
    ).resolves.toBe(1);
    await expect(inApi(b, (tx) => boardPackTemplates.byId(tx, id))).resolves.toBeUndefined();
    const denied = await asRoleIn('app_api', a.tenant.id, async (client) => [
      await outcome(client, "UPDATE app.document_template_version SET title = 'Renamed'"),
      await outcome(client, 'DELETE FROM app.document_template_version'),
    ]);
    expect(denied).toEqual(['42501', '42501']);
    expect(
      await rows<{ title: string }>(a, 'SELECT title FROM app.document_template_version'),
    ).toEqual([{ title: 'Board pack' }]);
  });
});
