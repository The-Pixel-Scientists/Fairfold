// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's CSV import against the test database: the routes as app_api, each
// call in its own tenant transaction like a request, and the parse job as
// app_worker, with a second tenant to prove isolation. Names, emails and
// cells are invented and recognisable, so a test can look for them in audit
// events, job rows and refusals. The platform's own checks (permission,
// step-up, module switch) run before a handler and are tested with the API.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { classification } from '../../../../../packages/db/classification.ts';
import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { attempt } from '../../../../../packages/db/src/savepoint.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import { importJobRow } from '../../../../../packages/db/test/crm/fixtures.ts';
import { addFile } from '../../../../../packages/db/test/grants/application-fixtures.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import type { CrmContext, CrmDependencies, Tx } from '../context.ts';
import { testImportFiles, testImportParties } from '../test-support/imports.ts';
import type { ImportDependencies } from './context.ts';
import { importHandlers, importParser } from './index.ts';

// Each request opens its own transactions and a busy machine is slow.
vi.setConfig({ testTimeout: 60_000 });

type Db = ReturnType<typeof createDatabase<unknown>>;

interface Event {
  readonly read: boolean;
  readonly action: string;
  readonly entityId: string;
  readonly subjectPartyId?: string;
  readonly changes?: Record<string, unknown>;
}

let api: Db;
let worker: Db;
let a: TestTenant;
let b: TestTenant;
let c: TestTenant;
let memberA: string;
let memberB: string;

const contents = new Map<string, Uint8Array>();
const queued: { importId: string; membershipId: string }[] = [];

const crmDeps = {
  notFound: () => new Error('Not found'),
  refuse: (status: number, detail: string) => Object.assign(new Error(detail), { status }),
  attempt: (tx: Tx, work: () => Promise<void>) => attempt(tx, work),
} as unknown as CrmDependencies;

const parties = testImportParties((tenant, sql, values) =>
  asMigratorIn(tenant, async (client) =>
    (await client.query<{ id: string }>(sql, values)).rows.map(({ id }) => id),
  ),
);
const imports: ImportDependencies = {
  files: testImportFiles(contents),
  parties,
  queueParse: (_tx, importId, { membershipId }) => {
    queued.push({ importId, membershipId });
    return Promise.resolve();
  },
};
const handlers = importHandlers(crmDeps, imports);
const parse = importParser(imports);

const PEOPLE_HEADER = 'Given name,Family name,Email,Phone\r\n';
const PEOPLE = [
  { column: 1, field: 'given_name' },
  { column: 2, field: 'family_name' },
  { column: 3, field: 'email' },
  { column: 4, field: 'phone' },
];
const startBody = (fileId: string, change = {}) => ({
  fileId,
  target: 'person' as const,
  headerRow: true,
  mapping: PEOPLE,
  ...change,
});

const inTenant = <T>(database: Db, tenant: TestTenant, work: (tx: Tx) => Promise<T>) =>
  withTenant(database, trustedTenantId(tenant.id), work);

function request(tenant: TestTenant, member: string) {
  const events: Event[] = [];
  const context: CrmContext = {
    audit: {
      record: (event) => Promise.resolve(void events.push({ read: false, ...event })),
      read: (event) => Promise.resolve(void events.push({ read: true, ...event })),
    },
    config: { record: () => Promise.resolve() },
    session: {
      userId: randomUUID(),
      tenant: tenant.id,
      email: () => Promise.resolve('x@example.test'),
    },
    membership: { id: member },
  };
  return { events, context };
}

/** Runs `work` as one request of `member` in `tenant`. */
const asStaff = <T>(
  tenant: TestTenant,
  member: string,
  work: (r: ReturnType<typeof request> & { tx: Tx }) => Promise<T>,
  database: Db = api,
) => inTenant(database, tenant, (tx) => work({ tx, ...request(tenant, member) }));
const asA = <T>(work: Parameters<typeof asStaff<T>>[2]) => asStaff(a, memberA, work);
const asB = <T>(work: Parameters<typeof asStaff<T>>[2]) => asStaff(b, memberB, work);

const query = <T extends object>(tenant: TestTenant, sql: string, values: unknown[] = []) =>
  asMigratorIn(tenant.id, async (client) => (await client.query<T>(sql, values)).rows);

const rejection = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error as Error & { status?: number };
  }
  throw new Error('Expected the call to fail.');
};

/** A clean file holding `text`, as the upload would leave it. */
async function upload(
  tenant: TestTenant,
  member: string,
  content: string | Uint8Array,
  state: 'pending' | 'clean' | 'infected' | 'error' = 'clean',
) {
  const id = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, member, state));
  contents.set(id, typeof content === 'string' ? new TextEncoder().encode(content) : content);
  return id;
}

/** Starts an import in tenant A and returns its job id. */
async function start(text: string, change = {}) {
  const fileId = await upload(a, memberA, text);
  const { job } = await asA(async ({ tx, context }) => ({
    job: await handlers.startImport({ tx, context, input: { body: startBody(fileId, change) } }),
  }));
  return job.id;
}

const parseAsWorker = (tenant: TestTenant, importId: string) =>
  inTenant(worker, tenant, (tx) => parse(tx, importId));

const confirm = (importId: string, duplicates: 'skip' | 'create', member = memberA) =>
  asA(({ tx, context }) =>
    handlers.confirmImport({
      tx,
      context: { ...context, membership: { id: member } },
      input: { params: { importId }, body: { duplicates } },
    }),
  );

const fileOf = async (job: string) =>
  (
    await query<{ file_id: string }>(a, 'SELECT file_id FROM crm.import_job WHERE id = $1', [job])
  )[0]?.file_id ?? '';

const countOf = async (tenant: TestTenant, table: string) =>
  Number((await query<{ n: string }>(tenant, `SELECT count(*) AS n FROM ${table}`))[0]?.n);

/** Six rows: two valid, one formula, one repeat, one like an existing person and one missing a field. */
const peopleFile = (tag = randomUUID().slice(0, 8)) =>
  [
    PEOPLE_HEADER,
    `Ada,Quillfeather,ada.${tag}@example.test,+44 7700 900982\r\n`,
    '=cmd|calc,Marsh,bob.marsh@example.test,\r\n',
    `Cleo,Thornwick,cleo.${tag}@example.test,\r\n`,
    `Cleo,Thornwick,CLEO.${tag}@example.test,\r\n`,
    'Dan,Existing,dan.existing@example.test,\r\n',
    ',Marsh,eve.marsh@example.test,\r\n',
  ].join('');

beforeAll(async () => {
  const apiSettings = databaseSettings('app_api', 4);
  api = createDatabase({
    host: apiSettings.host,
    port: apiSettings.port,
    database: apiSettings.database,
    password: apiSettings.password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  const workerSettings = databaseSettings('app_worker', 4);
  worker = createDatabase({
    host: workerSettings.host,
    port: workerSettings.port,
    database: workerSettings.database,
    password: workerSettings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b, c] = await Promise.all([createTestTenant(), createTestTenant(), createTestTenant()]);
  memberA = await asMigratorIn(a.id, (client) => addMember(client, a));
  memberB = await asMigratorIn(b.id, (client) => addMember(client, b));
  for (const tenant of [a, b]) {
    await asMigratorIn(tenant.id, (client) =>
      client.query(
        `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
         VALUES ($1, 'crm', true, 'operator')`,
        [tenant.id],
      ),
    );
  }
  await asMigratorIn(a.id, (client) =>
    addPerson(client, a, { email: 'dan.existing@example.test', given_name: 'Daniel' }),
  );
}, 60_000);

afterAll(async () => {
  await Promise.all([api.destroy(), worker.destroy()]);
});

describe('start', () => {
  it('links the file, queues the parse job and audits ids only', async () => {
    const fileId = await upload(a, memberA, PEOPLE_HEADER);
    const { job, events } = await asA(async ({ tx, context, events }) => ({
      events,
      job: await handlers.startImport({ tx, context, input: { body: startBody(fileId) } }),
    }));
    expect(job).toMatchObject({
      target: 'person',
      state: 'queued',
      failure: null,
      rows: { total: 0, valid: 0, withErrors: 0, duplicates: 0 },
      result: null,
      completedAt: null,
    });
    expect(queued.at(-1)).toEqual({ importId: job.id, membershipId: memberA });
    expect(events).toEqual([
      {
        read: false,
        action: 'crm.import.started',
        entityId: job.id,
        changes: {
          'crm.import_job.target_kind': { after: 'person' },
          'crm.import_job.file_id': { after: fileId },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('Given name');
    const [stored] = await query<{ requested_by: string; column_mapping: unknown }>(
      a,
      'SELECT requested_by, column_mapping FROM crm.import_job WHERE id = $1',
      [job.id],
    );
    expect(stored).toEqual({
      requested_by: memberA,
      column_mapping: { 1: 'given_name', 2: 'family_name', 3: 'email', 4: 'phone' },
    });
  });

  it('refuses a file that is not clean, is another tenant’s, or is already in use, and writes nothing', async () => {
    const before = await countOf(a, 'crm.import_job');
    const used = await start(PEOPLE_HEADER);
    const files = [
      await upload(a, memberA, PEOPLE_HEADER, 'pending'),
      await upload(a, memberA, PEOPLE_HEADER, 'infected'),
      await upload(a, memberA, PEOPLE_HEADER, 'error'),
      await upload(b, memberB, PEOPLE_HEADER),
      await fileOf(used),
      randomUUID(),
    ];
    const queuedBefore = queued.length;
    for (const fileId of files) {
      let audited: Event[] = [{ read: false, action: 'untouched', entityId: '' }];
      const refusal = await rejection(
        asA(({ tx, context, events }) => {
          audited = events;
          return handlers.startImport({ tx, context, input: { body: startBody(fileId) } });
        }),
      );
      expect(audited).toEqual([]);
      expect(refusal.status).toBe(409);
      expect(refusal.message).not.toContain(fileId);
    }
    expect(await countOf(a, 'crm.import_job')).toBe(before + 1);
    expect(queued).toHaveLength(queuedBefore);
  });
});

describe('parse job', () => {
  it('checks every row, stores problems as codes, and sets the duplicate', async () => {
    const id = await start(peopleFile());
    expect(await parseAsWorker(a, id)).toBe('parsed');

    const rows = await query<{
      row_number: number;
      cells: Record<string, string>;
      errors: { field: string; code: string }[];
      duplicate_party_id: string | null;
    }>(a, 'SELECT * FROM crm.import_row WHERE job_id = $1 ORDER BY row_number', [id]);
    expect(rows.map((row) => [row.row_number, row.errors])).toEqual([
      [2, []],
      [3, [{ field: 'given_name', code: 'formula' }]],
      [4, []],
      [5, [{ field: 'email', code: 'repeated_in_file' }]],
      [6, []],
      [7, [{ field: 'given_name', code: 'required' }]],
    ]);
    expect(rows[1]?.cells).not.toHaveProperty('given_name');
    expect(JSON.stringify(rows)).not.toContain('calc');
    expect(rows.map((row) => row.duplicate_party_id !== null)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);

    const job = await asA(({ tx, context }) =>
      handlers.getImport({ tx, context, input: { params: { importId: id } } }),
    );
    expect(job).toMatchObject({
      state: 'ready',
      rows: { total: 6, valid: 2, withErrors: 3, duplicates: 1 },
      completedAt: null,
    });
  });

  it('does nothing when it runs again, and survives rows that are already there', async () => {
    const id = await start(peopleFile());
    expect(await parseAsWorker(a, id)).toBe('parsed');
    expect(await parseAsWorker(a, id)).toBe('skipped');
    expect(await countOf(a, `crm.import_row WHERE job_id = '${id}'`)).toBe(6);

    const early = await start(peopleFile());
    await asMigratorIn(a.id, (client) =>
      insertRow(client, 'crm.import_row', {
        tenant_id: a.id,
        job_id: early,
        row_number: 2,
        cells: JSON.stringify({ given_name: 'Ada' }),
        errors: '[]',
      }),
    );
    expect(await parseAsWorker(a, early)).toBe('parsed');
    const [counts] = await query<{ row_count: number; valid_count: number }>(
      a,
      'SELECT row_count, valid_count FROM crm.import_job WHERE id = $1',
      [early],
    );
    expect(counts).toEqual({ row_count: 6, valid_count: 3 });
  });

  it.each([
    [
      'a file that is not UTF-8',
      Uint8Array.of(0x47, 0x69, 0x76, 0x65, 0x6e, 0x0a, 0xe9, 0x0a),
      'not_csv',
    ],
    ['a malformed file', '"Given\r\nAda,Quillfeather\r\n', 'not_csv'],
    ['a file with only a header', PEOPLE_HEADER, 'no_rows'],
    ['a file with 5,001 rows', `h\r\n${'x\r\n'.repeat(5001)}`, 'too_many_rows'],
    ['a file with 51 columns', `${'x,'.repeat(50)}x\r\n1\r\n`, 'too_many_columns'],
    ['a file over the byte cap', new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61), 'too_large'],
  ])('fails the job with a fixed code for %s', async (_name, content, code) => {
    const id = await start(PEOPLE_HEADER);
    contents.set(
      await fileOf(id),
      typeof content === 'string' ? new TextEncoder().encode(content) : content,
    );
    expect(await parseAsWorker(a, id)).toBe('refused');
    const [job] = await query<{ state: string; error_code: string; row_count: number }>(
      a,
      'SELECT state, error_code, row_count FROM crm.import_job WHERE id = $1',
      [id],
    );
    expect(job).toEqual({ state: 'failed', error_code: code, row_count: 0 });
    expect(await countOf(a, `crm.import_row WHERE job_id = '${id}'`)).toBe(0);
  });

  it('fails a file the storage no longer has as unreadable', async () => {
    const id = await start(PEOPLE_HEADER);
    contents.delete(await fileOf(id));
    expect(await parseAsWorker(a, id)).toBe('refused');
    const [job] = await query<{ error_code: string }>(
      a,
      'SELECT error_code FROM crm.import_job WHERE id = $1',
      [id],
    );
    expect(job?.error_code).toBe('file_unreadable');
  });

  it('writes nothing while crm is off for the tenant, and for a job that is not there', async () => {
    const job = await asMigratorIn(c.id, async (client) => {
      const member = await addMember(client, c);
      const file = await addFile(client, c, member);
      return insertRow(client, 'crm.import_job', importJobRow(c, file, member));
    });
    expect(await parseAsWorker(c, job)).toBe('skipped');
    const [row] = await query<{ state: string }>(
      c,
      'SELECT state FROM crm.import_job WHERE id = $1',
      [job],
    );
    expect(row?.state).toBe('queued');
    expect(await parseAsWorker(a, randomUUID())).toBe('missing');
  });

  it("cannot read another tenant's job or file", async () => {
    const id = await start(peopleFile());
    expect(await parseAsWorker(b, id)).toBe('missing');
    const [row] = await query<{ state: string }>(
      a,
      'SELECT state FROM crm.import_job WHERE id = $1',
      [id],
    );
    expect(row?.state).toBe('queued');
    expect(await countOf(b, 'crm.import_row')).toBe(0);
  });
});

describe('preview', () => {
  it('pages rows with errors and duplicate signals, audits the read and creates nothing', async () => {
    const id = await start(peopleFile());
    await parseAsWorker(a, id);
    const people = await countOf(a, 'party.person');

    const { page, events } = await asA(async ({ tx, context, events }) => ({
      events,
      page: await handlers.listImportRows({
        tx,
        context,
        input: { params: { importId: id }, query: {} },
      }),
    }));
    expect(page.nextCursor).toBeNull();
    expect(page.rows.map(({ row, status }) => [row, status])).toEqual([
      [2, 'valid'],
      [3, 'error'],
      [4, 'valid'],
      [5, 'error'],
      [6, 'duplicate'],
      [7, 'error'],
    ]);
    expect(page.rows[0]?.values).toMatchObject({ given_name: 'Ada', family_name: 'Quillfeather' });
    expect(page.rows[4]?.duplicates).toEqual([
      { partyId: expect.any(String) as string, signals: ['email'] },
    ]);
    expect(events).toEqual([{ read: true, action: 'crm.import.previewed', entityId: id }]);
    expect(await countOf(a, 'party.person')).toBe(people);
  });

  it('pages a long file by cursor without repeating a row', async () => {
    const lines = Array.from(
      { length: 60 },
      (_, n) => `Pat,Page${n},pat.page${n}@example.test,\r\n`,
    );
    const id = await start(PEOPLE_HEADER + lines.join(''));
    await parseAsWorker(a, id);
    const read = (cursor?: string) =>
      asA(({ tx, context }) =>
        handlers.listImportRows({
          tx,
          context,
          input: { params: { importId: id }, query: { cursor } },
        }),
      );
    const first = await read();
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await read(first.nextCursor ?? undefined);
    expect(second.rows.map(({ row }) => row)).toEqual(Array.from({ length: 10 }, (_, n) => n + 52));
    expect(second.nextCursor).toBeNull();
  });

  it("reads another tenant's job as missing", async () => {
    const id = await start(peopleFile());
    await parseAsWorker(a, id);
    const refusal = await rejection(
      asB(({ tx, context }) =>
        handlers.listImportRows({ tx, context, input: { params: { importId: id }, query: {} } }),
      ),
    );
    expect(refusal.message).toBe('Not found');
    const status = await rejection(
      asB(({ tx, context }) =>
        handlers.getImport({ tx, context, input: { params: { importId: id } } }),
      ),
    );
    expect(status.message).toBe('Not found');
  });
});

describe('confirm', () => {
  it('creates a record for each row without errors, skipping duplicates, and audits each', async () => {
    const tag = randomUUID().slice(0, 8);
    const id = await start(peopleFile(tag));
    await parseAsWorker(a, id);
    const { result, events } = await asA(async ({ tx, context, events }) => ({
      events,
      result: await handlers.confirmImport({
        tx,
        context,
        input: { params: { importId: id }, body: { duplicates: 'skip' } },
      }),
    }));
    expect(result).toEqual({ created: 2, skippedErrors: 3, skippedDuplicates: 1 });

    const rows = await query<{ row_number: number; created_party_id: string | null }>(
      a,
      'SELECT row_number, created_party_id FROM crm.import_row WHERE job_id = $1 ORDER BY row_number',
      [id],
    );
    expect(rows.map((row) => row.created_party_id !== null)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    const [job] = await query<{ state: string; confirmed_by: string; created_count: number }>(
      a,
      'SELECT state, confirmed_by, created_count FROM crm.import_job WHERE id = $1',
      [id],
    );
    expect(job).toEqual({ state: 'completed', confirmed_by: memberA, created_count: 2 });

    const made = rows.flatMap((row) =>
      row.created_party_id === null ? [] : [row.created_party_id],
    );
    expect(
      events.map(({ action, entityId, subjectPartyId }) => [action, entityId, subjectPartyId]),
    ).toEqual([
      ['party.person.created', made[0], made[0]],
      ['party.person.created', made[1], made[1]],
      ['crm.import.confirmed', id, undefined],
    ]);
    expect(events.at(-1)?.changes).toEqual({
      'crm.import_job.row_count': { after: 6 },
      'crm.import_job.created_count': { after: 2 },
    });
    for (const event of events) {
      for (const field of Object.keys(event.changes ?? {})) {
        const [, table = '', column = ''] = /^(.+)\.([a-z_0-9]+)$/.exec(field)?.slice(0) ?? [];
        expect(classification[table]?.[column], field).toBeDefined();
      }
    }
    const text = JSON.stringify(events);
    for (const secret of ['Quillfeather', 'Thornwick', 'example.test', 'calc']) {
      expect(text).not.toContain(secret);
    }

    const people = await query<{ email: string; user_id: string | null }>(
      a,
      'SELECT email, user_id FROM party.person WHERE id = ANY($1)',
      [made],
    );
    expect(people.map((person) => person.email).sort()).toEqual([
      `ada.${tag}@example.test`,
      `cleo.${tag}@example.test`,
    ]);
    expect(people.every((person) => person.user_id === null)).toBe(true);
    expect(await countOf(a, `party.consent WHERE person_id = ANY('{${made.join(',')}}')`)).toBe(0);
  });

  it('adds rows like an existing record when staff choose, and never confirms twice', async () => {
    const id = await start(peopleFile());
    await parseAsWorker(a, id);
    expect(await confirm(id, 'create')).toEqual({
      created: 3,
      skippedErrors: 3,
      skippedDuplicates: 0,
    });
    const again = await rejection(confirm(id, 'create'));
    expect(again.status).toBe(409);
    expect(
      await countOf(a, `crm.import_row WHERE job_id = '${id}' AND created_party_id IS NOT NULL`),
    ).toBe(3);
  });

  it('refuses a job that is not ready, whatever its state, and creates nothing', async () => {
    const queuedJob = await start(peopleFile());
    const failed = await start(PEOPLE_HEADER);
    await parseAsWorker(a, failed);
    const people = await countOf(a, 'party.person');
    for (const id of [queuedJob, failed]) {
      const refusal = await rejection(confirm(id, 'skip'));
      expect(refusal.status).toBe(409);
    }
    expect(await countOf(a, 'party.person')).toBe(people);
  });

  it('is all or nothing: a failure undoes every record and row update', async () => {
    const id = await start(peopleFile());
    await parseAsWorker(a, id);
    const people = await countOf(a, 'party.person');
    let calls = 0;
    const failing = importHandlers(crmDeps, {
      ...imports,
      parties: {
        ...parties,
        create: (tx, party, by) => {
          if (++calls === 2) return Promise.reject(new Error('The second record failed.'));
          return parties.create(tx, party, by);
        },
      },
    });
    const failure = await rejection(
      asA(({ tx, context }) =>
        failing.confirmImport({
          tx,
          context,
          input: { params: { importId: id }, body: { duplicates: 'skip' } },
        }),
      ),
    );
    expect(failure.message).toBe('The second record failed.');
    expect(await countOf(a, 'party.person')).toBe(people);
    const [job] = await query<{ state: string; confirmed_by: string | null }>(
      a,
      'SELECT state, confirmed_by FROM crm.import_job WHERE id = $1',
      [id],
    );
    expect(job).toEqual({ state: 'ready', confirmed_by: null });
    expect(
      await countOf(a, `crm.import_row WHERE job_id = '${id}' AND created_party_id IS NOT NULL`),
    ).toBe(0);
    expect(await confirm(id, 'skip')).toMatchObject({ created: 2 });
  });

  it('never makes a second record for a row that already has one', async () => {
    const id = await start(peopleFile());
    await parseAsWorker(a, id);
    const existing = await asMigratorIn(a.id, (client) => addPerson(client, a));
    await query(
      a,
      'UPDATE crm.import_row SET created_party_id = $2 WHERE job_id = $1 AND row_number = 2',
      [id, existing],
    );
    const people = await countOf(a, 'party.person');
    expect(await confirm(id, 'skip')).toEqual({
      created: 1,
      skippedErrors: 3,
      skippedDuplicates: 1,
    });
    expect(await countOf(a, 'party.person')).toBe(people + 1);
  });

  it("reads another tenant's job as missing and creates nothing in either tenant", async () => {
    const id = await start(peopleFile());
    await parseAsWorker(a, id);
    const [peopleA, peopleB] = [await countOf(a, 'party.person'), await countOf(b, 'party.person')];
    const refusal = await rejection(
      asB(({ tx, context }) =>
        handlers.confirmImport({
          tx,
          context,
          input: { params: { importId: id }, body: { duplicates: 'create' } },
        }),
      ),
    );
    expect(refusal.message).toBe('Not found');
    expect([await countOf(a, 'party.person'), await countOf(b, 'party.person')]).toEqual([
      peopleA,
      peopleB,
    ]);
    const [job] = await query<{ state: string }>(
      a,
      'SELECT state FROM crm.import_job WHERE id = $1',
      [id],
    );
    expect(job?.state).toBe('ready');
  });
});
