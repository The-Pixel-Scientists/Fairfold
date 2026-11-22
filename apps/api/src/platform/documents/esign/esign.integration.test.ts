// SPDX-License-Identifier: AGPL-3.0-or-later
//
// E-signature against the test database (ADR 0040): the send service as
// app_api, the send and refresh jobs as app_worker, and the fake provider.
// Two tenants throughout, so each case also proves the other tenant's data is
// out of reach. The worker's file writer is a stand-in that adds clean files
// as migrator, since only the file service writes files (see the report).

import { randomUUID } from 'node:crypto';

import { withTenant } from '@pixel-scientists/db';
import type { JobHandler } from '@pixel-scientists/db/jobs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { trustedTenantId } from '../../../../../../packages/db/src/tenant-context.ts';
import { withClient } from '../../../../../../packages/db/test/connect.ts';
import { addErasureRequest, erase } from '../../../../../../packages/db/test/erasure/fixtures.ts';
import { addFile } from '../../../../../../packages/db/test/grants/application-fixtures.ts';
import { connectionRow, fileHash } from '../../../../../../packages/db/test/documents/fixtures.ts';
import {
  jobRows,
  startJobsTest,
  stopJobsTest,
  type JobsTest,
} from '../../../../../../packages/db/test/jobs/helpers.ts';
import { addPerson } from '../../../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type Row,
  type TestTenant,
} from '../../../../../../packages/db/test/tenants.ts';
import { recordAudit, recordRead } from '../../../audit/writer.ts';
import { documentsErasure } from '../erasure.ts';
import { documentsSubjectData } from '../subject-data.ts';
import { FAKE_EVIDENCE_PDF, FakeEsignProvider } from './fake.ts';
import { esignHandlers, type EsignJobDependencies } from './index.ts';
import { createSigning } from './send.ts';

vi.setConfig({ testTimeout: 60_000 });

interface Funder {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly person: string;
  readonly other: string;
  readonly connection: string;
}

let test: JobsTest;
let a: Funder;
let b: Funder;
let fake: FakeEsignProvider;
let stored: Mock<(request: { id: string; createdBy: string }) => void>;

const signing = () => createSigning({ sender: test.apiSender, provider: 'fake' });

async function addFunder(withConnection = true): Promise<Funder> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => ({
    tenant,
    member: await addMember(client, tenant, ['programme_manager']),
    person: await addPerson(client, tenant),
    other: await addPerson(client, tenant),
    connection: withConnection
      ? await insertRow(
          client,
          'app.signature_connection',
          connectionRow(tenant, { provider: 'fake' }),
        )
      : '',
  }));
}

beforeAll(async () => {
  test = await startJobsTest();
  [a, b] = [await addFunder(), await addFunder()];
}, 60_000);
afterAll(() => stopJobsTest(test));
beforeEach(() => {
  fake = new FakeEsignProvider();
  stored = vi.fn();
});

const newFile = (f: Funder, state: 'pending' | 'clean' | 'infected' = 'clean') =>
  asMigratorIn(f.tenant.id, (client) => addFile(client, f.tenant, f.member, state));

const read = <T extends Row>(f: Funder, text: string, values: unknown[] = []) =>
  asMigratorIn(f.tenant.id, async (client) => (await client.query<T>(text, values)).rows);

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

interface AskOptions {
  readonly signers?: readonly string[];
  readonly input?: Row;
  readonly failAfter?: boolean;
}

/** The send service as the API calls it, in a request transaction of `f`'s tenant. */
async function ask(f: Funder, fileId: string, options: AskOptions = {}) {
  const requestId = randomUUID();
  const signers = (options.signers ?? [f.person]).map((personId, i) => ({
    personId,
    order: i + 1,
  }));
  return withTenant(test.api, trustedTenantId(f.tenant.id), async (tx) => {
    const kind = { kind: 'user', membershipId: f.member, requestId } as const;
    const result = await signing()(
      tx,
      {
        tenant: f.tenant.id,
        membershipId: f.member,
        requestId,
        audit: {
          record: (event) => recordAudit(tx, kind, event),
          read: (entity) => recordRead(tx, kind, entity),
        },
      },
      { fileId, signers, expiresAt: inDays(7), ...options.input },
    );
    if (options.failAfter === true) throw new Error('The request failed after the service ran.');
    return result;
  });
}

const deps = (f: Funder, change: Partial<EsignJobDependencies> = {}): EsignJobDependencies => ({
  providers: (key) => (key === 'fake' ? fake : undefined),
  open: ({ accountId }) => ({ accountId, apiToken: 'test-token' }),
  readFile: (key) => Promise.resolve(Buffer.from(key.split('/').at(-1) ?? '')),
  storeResults: async (_trx, request) => {
    stored(request);
    return asMigratorIn(f.tenant.id, async (client) => ({
      signed: await addFile(client, f.tenant, request.createdBy),
      evidence: await addFile(client, f.tenant, request.createdBy),
    }));
  },
  ...change,
});

/** Run one signature job as the wrapper would: in `f`'s tenant, as the system for its member. */
function run(
  f: Funder,
  handler: 'send' | 'refresh',
  signature: string,
  change: Partial<EsignJobDependencies> = {},
) {
  const [send, refresh] = esignHandlers(deps(f, change)) as [
    JobHandler<unknown>,
    JobHandler<unknown>,
  ];
  const jobHandler = handler === 'send' ? send : refresh;
  return withTenant(test.worker, trustedTenantId(f.tenant.id), (trx) =>
    jobHandler.handle(trx, {
      id: randomUUID(),
      data: { signature },
      context: { sender: test.workerSender, requestId: randomUUID(), causingUserId: f.member },
    }),
  );
}

const state = async (f: Funder, id: string) =>
  (
    await read<{ status: string; error_code: string | null; provider_reference: string | null }>(
      f,
      'SELECT status, error_code, provider_reference FROM app.signature_request WHERE id = $1',
      [id],
    )
  )[0];

/** A request the send job has sent through the fake provider. */
async function sent(f: Funder, signers?: readonly string[]) {
  const { id } = await ask(f, await newFile(f), { signers });
  await run(f, 'send', id);
  const reference = (await state(f, id))?.provider_reference ?? '';
  return { id, reference };
}

const events = (f: Funder, id: string) =>
  read<{
    action: string;
    actor_kind: string;
    actor_id: string | null;
    job_id: string | null;
    origin_membership_id: string | null;
    subject_party_id: string | null;
    changes: Record<string, unknown>;
  }>(
    f,
    `SELECT action, actor_kind, actor_id, job_id, origin_membership_id, subject_party_id, changes
       FROM app.audit_event WHERE entity_id = $1 AND action LIKE 'platform.signature.%'
      ORDER BY occurred_at, subject_party_id`,
    [id],
  );

describe('asking for a signature', () => {
  it('writes the draft, its signers and the file link, audits each signer, and queues an ids-only job', async () => {
    const file = await newFile(a);
    const { id } = await ask(a, file, { signers: [a.person, a.other] });

    expect(await state(a, id)).toEqual({
      status: 'draft',
      error_code: null,
      provider_reference: null,
    });
    const [request] = await read<{
      created_by: string;
      connection_id: string;
      sent_sha256: Buffer;
    }>(
      a,
      'SELECT created_by, connection_id, sent_sha256 FROM app.signature_request WHERE id = $1',
      [id],
    );
    expect(request).toMatchObject({ created_by: a.member, connection_id: a.connection });
    expect(request?.sent_sha256.equals(fileHash(file))).toBe(true);
    expect(
      await read(
        a,
        'SELECT person_id, signing_order FROM app.signature_signer WHERE signature_request_id = $1 ORDER BY signing_order',
        [id],
      ),
    ).toEqual([
      { person_id: a.person, signing_order: 1 },
      { person_id: a.other, signing_order: 2 },
    ]);
    expect(
      await read(
        a,
        'SELECT role, file_id FROM app.signature_request_file WHERE signature_request_id = $1',
        [id],
      ),
    ).toEqual([{ role: 'sent', file_id: file }]);

    const audited = await events(a, id);
    expect(audited.map((event) => event.subject_party_id).sort()).toEqual(
      [a.person, a.other].sort(),
    );
    for (const event of audited) {
      expect(event).toMatchObject({
        action: 'platform.signature.requested',
        actor_kind: 'user',
        actor_id: a.member,
        changes: { 'app.signature_request.status': { after: 'draft' } },
      });
    }

    const jobs = await jobRows("name = 'platform.signature_send' AND data->>'signature' = $1", [
      id,
    ]);
    expect(jobs).toHaveLength(1);
    expect(Object.keys(jobs[0]?.data ?? {}).sort()).toEqual(
      ['causingUserId', 'requestId', 'signature', 'tenantId'].sort(),
    );
    expect(jobs[0]?.data['tenantId']).toBe(a.tenant.id);
    expect(jobs[0]?.data['causingUserId']).toBe(a.member);
  });

  it('writes nothing, and sends no job, when the request rolls back', async () => {
    const file = await newFile(a);
    await expect(ask(a, file, { failAfter: true })).rejects.toThrow('after the service ran');
    expect(
      await read(a, 'SELECT 1 FROM app.signature_request_file WHERE file_id = $1', [file]),
    ).toEqual([]);
  });

  it('takes the sender, tenant and status from the context, never from the input', async () => {
    const file = await newFile(a);
    for (const input of [
      { createdBy: b.member },
      { tenantId: b.tenant.id },
      { status: 'signed' },
      { callbackReference: 'x'.repeat(43) },
      { email: 'signer@example.org' },
    ]) {
      await expect(ask(a, file, { input }), JSON.stringify(input)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(
      await read(a, 'SELECT 1 FROM app.signature_request_file WHERE file_id = $1', [file]),
    ).toEqual([]);
  });

  it('refuses no signers, a signer twice, and an expiry that is past or beyond 90 days', async () => {
    const file = await newFile(a);
    const cases: AskOptions[] = [
      { signers: [] },
      { signers: [a.person, a.person] },
      { input: { expiresAt: inDays(-1) } },
      { input: { expiresAt: inDays(91) } },
      { input: { expiresAt: 'tomorrow' } },
    ];
    for (const options of cases) {
      await expect(ask(a, file, options)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('refuses a file that is not a clean PDF nobody else uses, with one answer for every case', async () => {
    const used = await newFile(a);
    await ask(a, used);
    const files = [
      await newFile(a, 'pending'),
      await newFile(a, 'infected'),
      used,
      randomUUID(),
      await newFile(b),
    ];
    const answers = [];
    for (const file of files) {
      const refused = await ask(a, file).catch((error: unknown) => error);
      expect(refused).toMatchObject({ status: 400 });
      answers.push((refused as Error).message);
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).not.toMatch(/another|tenant|pending|infected/i);
  });

  it('refuses a signer who is not a person of this tenant', async () => {
    const file = await newFile(a);
    for (const person of [b.person, randomUUID()]) {
      await expect(ask(a, file, { signers: [a.person, person] })).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(
      await read(a, 'SELECT 1 FROM app.signature_request_file WHERE file_id = $1', [file]),
    ).toEqual([]);
  });

  it('refuses a template version of another tenant', async () => {
    await expect(
      ask(a, await newFile(a), { input: { templateVersionId: randomUUID() } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('is refused while the tenant has no connection or the cell has no provider', async () => {
    const c = await addFunder(false);
    await expect(ask(c, await newFile(c))).rejects.toMatchObject({ status: 409 });
    const off = createSigning({ sender: test.apiSender, provider: null });
    await expect(
      withTenant(test.api, trustedTenantId(a.tenant.id), async (tx) =>
        off(
          tx,
          {
            tenant: a.tenant.id,
            membershipId: a.member,
            requestId: randomUUID(),
            audit: { record: () => Promise.resolve(), read: () => Promise.resolve() },
          },
          {
            fileId: randomUUID(),
            signers: [{ personId: a.person, order: 1 }],
            expiresAt: inDays(1),
          },
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('shows the API role no signature request while no tenant is set, and each tenant only its own', async () => {
    const { id } = await ask(a, await newFile(a));
    await withClient('app_api', async (client) => {
      expect((await client.query('SELECT 1 FROM app.signature_request')).rowCount).toBe(0);
    });
    expect(await read(b, 'SELECT 1 FROM app.signature_request WHERE id = $1', [id])).toEqual([]);
  });
});

describe('the send job', () => {
  it('sends the document and moves the request to sent, with audit and no address stored', async () => {
    const { id, reference } = await sent(a, [a.person, a.other]);
    expect(reference).toMatch(/^fake-/);
    expect(await state(a, id)).toMatchObject({ status: 'sent', error_code: null });
    const envelope = fake.envelopes.get(reference);
    expect(envelope?.requestId).toBe(id);
    expect(envelope?.signers).toEqual([
      { personId: a.person, order: 1 },
      { personId: a.other, order: 2 },
    ]);

    const audited = (await events(a, id)).filter(
      (event) => event.action === 'platform.signature.sent',
    );
    expect(audited.map((event) => event.subject_party_id).sort()).toEqual(
      [a.person, a.other].sort(),
    );
    for (const event of audited) {
      expect(event).toMatchObject({
        actor_kind: 'system',
        actor_id: null,
        origin_membership_id: a.member,
        changes: { 'app.signature_request.status': { after: 'sent' } },
      });
      expect(event.job_id).toBeTruthy();
    }
    // Neither table holds an address: no column of either is text a person typed.
    const columns = await read<{ column_name: string }>(
      a,
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name IN ('signature_request', 'signature_signer')`,
    );
    expect(
      columns.map((column) => column.column_name).filter((name) => /mail|address|name/.test(name)),
    ).toEqual([]);
  });

  it('does nothing when it runs again, and finds the envelope an earlier run made', async () => {
    const { id } = await sent(a);
    await run(a, 'send', id);
    expect(fake.envelopes.size).toBe(1);

    const second = await ask(a, await newFile(a));
    const connection = { accountId: 'team-1', apiToken: 'test-token' };
    const document = Buffer.from(
      (
        await read<{ id: string }>(
          a,
          'SELECT file_id AS id FROM app.signature_request_file WHERE signature_request_id = $1',
          [second.id],
        )
      )[0]?.id ?? '',
    );
    await fake.createEnvelope(
      connection,
      {
        requestId: second.id,
        document,
        signers: [{ personId: a.person, order: 1 }],
        expiresAt: inDays(7),
      },
      new Map([[a.person, { name: 'Test', email: 'test@example.org' }]]),
    );
    await run(a, 'send', second.id);
    expect(fake.envelopes.size).toBe(2);
    expect((await state(a, second.id))?.status).toBe('sent');
  });

  it('records a closed code, never the provider message, when the provider fails', async () => {
    const { id } = await ask(a, await newFile(a));
    fake.unavailable = true;
    await run(a, 'send', id);
    expect(await state(a, id)).toEqual({
      status: 'failed',
      error_code: 'signature.provider_unavailable',
      provider_reference: null,
    });
    const [failed] = await events(a, id).then((all) =>
      all.filter((e) => e.action === 'platform.signature.failed'),
    );
    expect(JSON.stringify(failed?.changes)).not.toMatch(/fake|unavailable provider/i);
    expect(failed?.changes).toEqual({
      'app.signature_request.status': { after: 'failed' },
      'app.signature_request.error_code': { after: 'signature.provider_unavailable' },
    });
  });

  it('fails when the stored bytes are not the file the request recorded', async () => {
    const { id } = await ask(a, await newFile(a));
    await run(a, 'send', id, { readFile: () => Promise.resolve(Buffer.from('another document')) });
    expect(await state(a, id)).toMatchObject({
      status: 'failed',
      error_code: 'signature.document_mismatch',
    });
    expect(fake.envelopes.size).toBe(0);
  });

  it('cancels at the provider and fails when its copy is not the document sent', async () => {
    const { id } = await ask(a, await newFile(a));
    vi.spyOn(fake, 'readOriginal').mockResolvedValue({ bytes: Buffer.from('altered') });
    await run(a, 'send', id);
    expect(await state(a, id)).toMatchObject({
      status: 'failed',
      error_code: 'signature.upload_mismatch',
    });
    expect([...fake.envelopes.values()].map((envelope) => envelope.state)).toEqual(['cancelled']);
  });

  it('fails a request whose connection names no adapter in this cell', async () => {
    const { id } = await ask(a, await newFile(a));
    await run(a, 'send', id, { providers: () => undefined });
    expect(await state(a, id)).toMatchObject({
      status: 'failed',
      error_code: 'signature.provider_unavailable',
    });
  });

  it("cannot read or update another tenant's request", async () => {
    const { id } = await ask(b, await newFile(b));
    await expect(run(a, 'send', id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await state(b, id))?.status).toBe('draft');
    expect(fake.envelopes.size).toBe(0);
  });
});

describe('the refresh job', () => {
  it('moves a request to viewed when a signer opens it, and reads the status from the provider', async () => {
    const { id, reference } = await sent(a);
    await run(a, 'refresh', id);
    expect((await state(a, id))?.status).toBe('sent');
    fake.view(reference);
    await run(a, 'refresh', id);
    expect((await state(a, id))?.status).toBe('viewed');
    expect(
      await read(a, 'SELECT status FROM app.signature_signer WHERE signature_request_id = $1', [
        id,
      ]),
    ).toEqual([{ status: 'viewed' }]);
    expect((await events(a, id)).map((event) => event.action)).toContain(
      'platform.signature.viewed',
    );
  });

  it('stores the signed file and evidence and links both in the move to signed', async () => {
    const { id, reference } = await sent(a, [a.person, a.other]);
    fake.complete(reference);
    await run(a, 'refresh', id);

    expect(await state(a, id)).toMatchObject({ status: 'signed', error_code: null });
    expect(stored).toHaveBeenCalledExactlyOnceWith({ id, createdBy: a.member });
    const links = await read<{ role: string; scan_state: string; linked: boolean }>(
      a,
      `SELECT l.role, f.scan_state, f.linked_at IS NOT NULL AS linked
         FROM app.signature_request_file l JOIN app.file f ON f.id = l.file_id
        WHERE l.signature_request_id = $1 ORDER BY l.role`,
      [id],
    );
    expect(links).toEqual([
      { role: 'evidence', scan_state: 'clean', linked: true },
      { role: 'sent', scan_state: 'clean', linked: true },
      { role: 'signed', scan_state: 'clean', linked: true },
    ]);
    const signers = await read<{ status: string; signed: boolean }>(
      a,
      'SELECT status, signed_at IS NOT NULL AS signed FROM app.signature_signer WHERE signature_request_id = $1',
      [id],
    );
    expect(signers).toEqual([
      { status: 'signed', signed: true },
      { status: 'signed', signed: true },
    ]);
    const audited = (await events(a, id)).filter(
      (event) => event.action === 'platform.signature.signed',
    );
    expect(audited.map((event) => event.subject_party_id).sort()).toEqual(
      [a.person, a.other].sort(),
    );
  });

  it('is harmless to run again, and a final request never moves', async () => {
    const { id, reference } = await sent(a);
    fake.complete(reference);
    await run(a, 'refresh', id);
    await run(a, 'refresh', id);
    expect(stored).toHaveBeenCalledTimes(1);
    fake.decline(reference);
    await run(a, 'refresh', id);
    expect((await state(a, id))?.status).toBe('signed');
    const actions = (await events(a, id)).map((event) => event.action);
    expect(actions.filter((action) => action === 'platform.signature.signed')).toHaveLength(1);
    expect(actions).not.toContain('platform.signature.declined');
  });

  it.each([
    ['declined', 'declined'],
    ['expired', 'expired'],
    ['cancelled', 'cancelled'],
  ] as const)(
    'moves a request the provider reports %s to %s and stores no file',
    async (providerState, status) => {
      const { id, reference } = await sent(a);
      fake.update(reference, { state: providerState });
      await run(a, 'refresh', id);
      expect((await state(a, id))?.status).toBe(status);
      expect(stored).not.toHaveBeenCalled();
      expect((await events(a, id)).map((event) => event.action)).toContain(
        `platform.signature.${status}`,
      );
    },
  );

  it('fails a request whose evidence names a different document, and saves nothing', async () => {
    const { id, reference } = await sent(a);
    fake.complete(reference);
    fake.update(reference, {
      evidence: { bytes: FAKE_EVIDENCE_PDF, originalSha256: 'ab'.repeat(32) },
    });
    await run(a, 'refresh', id);
    expect(await state(a, id)).toMatchObject({
      status: 'failed',
      error_code: 'signature.document_mismatch',
    });
    expect(stored).not.toHaveBeenCalled();
    expect(
      await read(
        a,
        "SELECT 1 FROM app.signature_request_file WHERE signature_request_id = $1 AND role <> 'sent'",
        [id],
      ),
    ).toEqual([]);
  });

  it('fails a request when the provider no longer holds the document sent, even with no evidence hash', async () => {
    const { id, reference } = await sent(a);
    fake.complete(reference);
    fake.update(reference, { evidence: { bytes: FAKE_EVIDENCE_PDF } });
    vi.spyOn(fake, 'readOriginal').mockResolvedValue({ bytes: Buffer.from('altered') });
    await run(a, 'refresh', id);
    expect(await state(a, id)).toMatchObject({
      status: 'failed',
      error_code: 'signature.document_mismatch',
    });
    expect(stored).not.toHaveBeenCalled();
    expect(
      await read(
        a,
        "SELECT 1 FROM app.signature_request_file WHERE signature_request_id = $1 AND role <> 'sent'",
        [id],
      ),
    ).toEqual([]);
  });

  it('fails a request whose signed hash does not match, or whose files are refused', async () => {
    const first = await sent(a);
    fake.complete(first.reference);
    fake.update(first.reference, {
      evidence: { bytes: FAKE_EVIDENCE_PDF, signedSha256: 'cd'.repeat(32) },
    });
    await run(a, 'refresh', first.id);
    expect((await state(a, first.id))?.error_code).toBe('signature.document_mismatch');

    const second = await sent(a);
    fake.complete(second.reference);
    await run(a, 'refresh', second.id, { storeResults: () => Promise.resolve(null) });
    expect(await state(a, second.id)).toMatchObject({
      status: 'failed',
      error_code: 'signature.document_mismatch',
    });
  });

  it('leaves the request as it was, and fails the job to retry, while the provider cannot be read', async () => {
    const { id, reference } = await sent(a);
    fake.complete(reference);
    fake.unavailable = true;
    await expect(run(a, 'refresh', id)).rejects.toMatchObject({ code: 'internal' });
    expect((await state(a, id))?.status).toBe('sent');
  });

  it('does nothing for a draft or a request of another tenant', async () => {
    const draft = await ask(a, await newFile(a));
    await run(a, 'refresh', draft.id);
    expect((await state(a, draft.id))?.status).toBe('draft');
    const { id } = await sent(b);
    await expect(run(a, 'refresh', id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await state(b, id))?.status).toBe('sent');
  });
});

describe('subject access and erasure', () => {
  const subject = (partyId: string) => ({
    partyId,
    givenName: null,
    familyName: null,
    email: null,
    accountId: null,
  });

  it("lists a request made here in the signer's export, and clears its file on erasure", async () => {
    const c = await addFunder();
    const file = await newFile(c);
    const { id } = await ask(c, file);
    const asWorker = <T>(f: Funder, work: Parameters<typeof withTenant<unknown, T>>[2]) =>
      withTenant(test.worker, trustedTenantId(f.tenant.id), work);

    const data = await asWorker(c, (tx) => documentsSubjectData.subjectData(tx, c.person));
    expect(
      data['app.signature_request']?.map((row) => row['app.signature_request.id']?.value),
    ).toEqual([id]);
    expect(data['app.signature_signer']).toHaveLength(1);
    expect(await asWorker(b, (tx) => documentsSubjectData.subjectData(tx, c.person))).toEqual({
      'app.signature_request': [],
      'app.signature_signer': [],
    });

    const request = await asMigratorIn(c.tenant.id, (client) =>
      addErasureRequest(client, c.tenant, c.member, c.person),
    );
    expect((await erase(c.tenant, c.person, request)).code).toBeUndefined();
    expect(await asWorker(c, (tx) => documentsErasure.erase(tx, [subject(c.person)]))).toEqual({
      'app.file': 1,
    });
    expect(
      await read(c, 'SELECT erased_at IS NOT NULL AS erased FROM app.file WHERE id = $1', [file]),
    ).toEqual([{ erased: true }]);
    expect((await state(c, id))?.status).toBe('draft');
  });

  it('refuses to send to a person who has since been erased, with no address kept', async () => {
    const c = await addFunder();
    const { id } = await ask(c, await newFile(c));
    const request = await asMigratorIn(c.tenant.id, (client) =>
      addErasureRequest(client, c.tenant, c.member, c.person),
    );
    expect((await erase(c.tenant, c.person, request)).code).toBeUndefined();
    await run(c, 'send', id);
    expect(await state(c, id)).toMatchObject({
      status: 'failed',
      error_code: 'signature.signer_unavailable',
    });
    expect(fake.envelopes.size).toBe(0);
  });
});
