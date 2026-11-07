// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rescans, the hash check, withholding and staff deletion (ADR 0030) against
// the test database as app_api, with a fake scanner and an in-memory object
// store (the real store and scanner are in files.integration.test.ts). The
// row lock, the state trigger and row-level security are the database's own.

import { createHash, randomUUID } from 'node:crypto';

import { createDatabase, withTenant, type Kysely } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  committedIn,
  createTestTenant,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import { addMember, events, type Member } from '../../../test/settings-api.ts';
import { recordAudit, recordRead } from '../../audit/writer.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { jobActor } from '../../worker/job-actor.ts';
import { filesHandler } from '../../worker/jobs/files.ts';
import type { Verdict } from './clamd.ts';
import { recheckTenant, type RecheckDependencies } from './recheck.ts';
import { sweepTenant, type SweepStorage } from './sweep.ts';
import { sendStoredFile, type SendDependencies } from './send.ts';
import { createSlots } from './slots.ts';
import type { Storage } from './storage.ts';
import type { FileRequest } from './types.ts';
import { deleteWithheld } from './withhold.ts';

let database: ApiDatabase;
let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let adminB: Member;
let worker: Kysely<unknown>;

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    TPS_SMTP_HOST: '127.0.0.1',
    TPS_SMTP_PORT: '51025',
    TPS_SMTP_TLS: 'none',
    TPS_SMTP_FROM: 'grants@example.org',
    TPS_API_PORT: '41003',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const creds = connectionSettings('app_worker');
  worker = createDatabase<unknown>({
    host: creds.host,
    port: creds.port,
    database: creds.database,
    role: 'app_worker',
    password: creds.password,
    maxConnections: 8,
    applicationName: 'tps-db-tests',
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await database.close();
  await worker.destroy();
});

/** The objects of one test: every key pair may do everything here, which storage-keys.test.ts covers. */
const memory = () => ({ objects: new Map<string, Buffer>() });

const pdf = Buffer.from('%PDF-1.4\n% Accounts\n%%EOF\n');

/** A clean file of `member`'s tenant, scanned under signature version `scanVersion`, with its object stored. */
async function cleanFile(
  member: Member,
  objects: Map<string, Buffer>,
  scanVersion: number | null = 100,
  bytes = pdf,
): Promise<string> {
  const id = await asMigratorIn(member.tenant.id, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.file (tenant_id, name, content_type, size_bytes, created_by)
       VALUES (app.current_tenant_id(), 'Accounts.pdf', 'application/pdf', $1, $2) RETURNING id`,
      [bytes.length, member.membershipId],
    );
    const file = rows[0]?.id ?? '';
    await client.query(
      `UPDATE app.file SET scan_state = 'clean', sha256 = $2, storage_key = $3, scan_version = $4
        WHERE id = $1`,
      [
        file,
        createHash('sha256').update(bytes).digest(),
        `clean/${member.tenant.id}/${file}`,
        scanVersion,
      ],
    );
    return file;
  });
  objects.set(`clean/${member.tenant.id}/${id}`, bytes);
  return id;
}

const row = (tenant: TestTenant, id: string) =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{
      scan_state: string;
      storage_key: string | null;
      sha256: Buffer | null;
      scan_version: number | null;
    }>('SELECT scan_state, storage_key, sha256, scan_version FROM app.file WHERE id = $1', [id]);
    return rows[0];
  });

/** Runs `work` as `member` in one request: a failure rolls back, and the after-commit work then runs. */
async function request<T>(member: Member, work: (request: FileRequest) => Promise<T>): Promise<T> {
  const later: (() => Promise<void>)[] = [];
  const result = await database.inTenant(trustedTenantId(member.tenant.id), (tx) => {
    const actor = {
      kind: 'user',
      membershipId: member.membershipId,
      requestId: randomUUID(),
    } as const;
    return work({
      tx,
      tenant: member.tenant.id,
      membershipId: member.membershipId,
      audit: {
        record: (event) => recordAudit(tx, actor, event),
        read: (entity) => recordRead(tx, actor, entity),
      },
      afterCommit: (after) => later.push(after),
    });
  });
  for (const after of later) await after();
  return result;
}

function sender(objects: Map<string, Buffer>, verdict: Verdict, version: number | null = 200) {
  const live: Storage = {
    put: (key, bytes) => {
      objects.set(key, Buffer.from(bytes));
      return Promise.resolve();
    },
    get: (key) => {
      const found = objects.get(key);
      return Promise.resolve(found === undefined ? null : new Response(found).body);
    },
  };
  const deps: SendDependencies = {
    storage: live,
    scanner: live,
    scan: () => Promise.resolve(verdict),
    version: () => Promise.resolve(version),
    slots: createSlots(4),
  };
  return (member: Member, id: string, pause?: () => Promise<void>) =>
    request(member, async (req) => {
      const reply = await sendStoredFile(deps, req, id, { audit: true });
      await pause?.();
      return reply;
    });
}

async function bytesOf(reply: Awaited<ReturnType<ReturnType<typeof sender>>>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of reply.body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe('a download after signatures changed', () => {
  it('records a clean rescan, then sends the bytes with the stored headers', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 100);
    const reply = await sender(objects, 'clean')(adminA, id);
    expect((await bytesOf(reply)).equals(pdf)).toBe(true);
    expect(reply.headers).toMatchObject({
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    expect(await row(tenantA, id)).toMatchObject({ scan_state: 'clean', scan_version: 200 });
    expect(await events(tenantA, 'platform.file.downloaded')).toHaveLength(1);
  });

  it('does not scan again when the file was scanned under the current version', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 200);
    // A scanner that would match is never asked.
    await sender(objects, 'infected')(adminA, id);
    expect(await row(tenantA, id)).toMatchObject({ scan_state: 'clean', scan_version: 200 });
  });

  it('withholds on a match: the bytes move to withheld/, the caller gets a 404, the event is kept', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 100);
    await expect(sender(objects, 'infected')(adminA, id)).rejects.toMatchObject({ status: 404 });
    expect(await row(tenantA, id)).toMatchObject({
      scan_state: 'withheld',
      storage_key: `withheld/${tenantA.id}/${id}`,
      scan_version: 200,
    });
    expect(objects.get(`withheld/${tenantA.id}/${id}`)?.equals(pdf)).toBe(true);
    const [event] = await events(tenantA, 'platform.file.withheld');
    expect(event).toMatchObject({ entity_id: id, actor_id: adminA.membershipId });
    expect(JSON.stringify(event)).not.toContain('Accounts');
    // Withheld is never served.
    await expect(sender(objects, 'clean')(adminA, id)).rejects.toMatchObject({ status: 404 });
  });

  it('answers 503 and changes nothing when the scanner cannot say or the version is unknown', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 100);
    for (const send of [sender(objects, 'error'), sender(objects, 'clean', null)]) {
      await expect(send(adminA, id)).rejects.toMatchObject({
        status: 503,
        headers: { 'retry-after': '5' },
      });
    }
    expect(await row(tenantA, id)).toMatchObject({ scan_state: 'clean', scan_version: 100 });
  });
});

describe('the hash check', () => {
  it('sends nothing and answers as for a missing file when the object changed or is gone', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 200);
    const key = `clean/${tenantA.id}/${id}`;
    objects.set(key, Buffer.from('%PDF-1.4\n% Changed\n%%EOF\n'));
    await expect(sender(objects, 'clean')(adminA, id)).rejects.toMatchObject({ status: 404 });
    objects.delete(key);
    await expect(sender(objects, 'clean')(adminA, id)).rejects.toMatchObject({ status: 404 });
    expect(await events(tenantA, 'platform.file.downloaded')).toHaveLength(1);
  });
});

describe('another tenant', () => {
  it('cannot download, withhold or delete the file, or learn of it', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 100);
    await expect(sender(objects, 'infected')(adminB, id)).rejects.toMatchObject({ status: 404 });
    await expect(request(adminB, (req) => deleteWithheld(req, id))).rejects.toMatchObject({
      status: 404,
    });
    expect(await row(tenantA, id)).toMatchObject({ scan_state: 'clean', scan_version: 100 });
    expect(objects.has(`withheld/${tenantA.id}/${id}`)).toBe(false);
    expect(objects.has(`withheld/${tenantB.id}/${id}`)).toBe(false);
  });
});

describe('staff deletion of a withheld file', () => {
  it('moves it to infected, clears the hash and key, and audits the acting membership', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 100);
    await sender(objects, 'infected')(adminA, id).catch(() => undefined);
    await request(adminA, (req) => deleteWithheld(req, id));
    expect(await row(tenantA, id)).toMatchObject({
      scan_state: 'infected',
      storage_key: null,
      sha256: null,
    });
    const [event] = await events(tenantA, 'platform.file.deleted');
    expect(event).toMatchObject({ entity_id: id, actor_id: adminA.membershipId });
    await expect(request(adminA, (req) => deleteWithheld(req, id))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses a file that is not withheld, with the same 404', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 100);
    await expect(request(adminA, (req) => deleteWithheld(req, id))).rejects.toMatchObject({
      status: 404,
    });
    expect(await row(tenantA, id)).toMatchObject({ scan_state: 'clean' });
  });
});

// ---------------------------------------------------------------------------
// Races, erasure and the tenant job (ADR 0030), against the real row lock:
// each pair runs on two connections, in both orders of taking the lock.

type Pause = () => Promise<void>;
type Task = (pause: Pause) => Promise<unknown>;

const OLD = new Date(0);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const idle: Pause = () => Promise.resolve();

/** The removal key over an in-memory store; `lists` records every prefix asked for. */
function removalOver(objects: Map<string, Buffer>, lists: string[] = []): SweepStorage['removal'] {
  return {
    head: (key) => Promise.resolve(objects.has(key) ? OLD : null),
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
    list: async function* (prefix) {
      await Promise.resolve();
      lists.push(prefix);
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) yield key;
    },
    versioned: () => Promise.resolve(false),
  };
}

function recheckOver(
  objects: Map<string, Buffer>,
  verdict: Verdict,
  version = 300,
): RecheckDependencies {
  return {
    scanner: {
      get: (key) => {
        const found = objects.get(key);
        return Promise.resolve(found === undefined ? null : new Response(found).body);
      },
    },
    restore: {
      put: (key, bytes) => {
        objects.set(key, Buffer.from(bytes));
        return Promise.resolve();
      },
    },
    scan: () => Promise.resolve(verdict),
    version: () => Promise.resolve(version),
  };
}

const jobContext = () => ({ sender: {} as never, requestId: randomUUID(), causingUserId: null });
const jobActing = () => jobActor({ id: randomUUID(), context: jobContext() });

const sweepTask =
  (tenant: TestTenant, objects: Map<string, Buffer>): Task =>
  (pause) =>
    withTenant(worker, trustedTenantId(tenant.id), async (trx) => {
      await sweepTenant(trx, { removal: removalOver(objects) }, tenant.id);
      await pause();
    });

const recheckTask =
  (tenant: TestTenant, objects: Map<string, Buffer>, verdict: Verdict, version = 300): Task =>
  (pause) =>
    withTenant(worker, trustedTenantId(tenant.id), async (trx) => {
      await recheckTenant(trx, recheckOver(objects, verdict, version), tenant.id, jobActing());
      await pause();
    });

const withholdTask =
  (objects: Map<string, Buffer>, member: Member, id: string, version = 200): Task =>
  (pause) =>
    sender(objects, 'infected', version)(member, id, pause).catch(() => undefined);

/** A erasure of the file (the trigger clears name, hash and key), committed after `pause`. */
const eraseTask =
  (tenant: TestTenant, id: string): Task =>
  (pause) =>
    withClient('migrator', (client) =>
      committedIn(client, tenant.id, async (c) => {
        await c.query('UPDATE app.file SET erased_at = now() WHERE id = $1', [id]);
        await pause();
      }),
    );

/** Runs `first` holding its row lock, starts `second` and shows it waiting, then lets `first` commit. */
async function race(first: Task, second: Task): Promise<void> {
  let release!: () => void;
  let held!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const holding = new Promise<void>((resolve) => (held = resolve));
  const a = first(async () => {
    held();
    await gate;
  });
  a.catch(held);
  await holding;
  let finished = false;
  const b = second(idle).finally(() => (finished = true));
  await sleep(400);
  expect(finished).toBe(false);
  release();
  await Promise.all([a, b]);
}

/** Both orders of taking the lock, each on a fresh file made by `build`. */
async function bothOrders(
  build: () => Promise<[Task, Task]>,
  check: () => Promise<void>,
): Promise<void> {
  for (const flip of [false, true]) {
    const [a, b] = await build();
    await (flip ? race(b, a) : race(a, b));
    await check();
  }
}

const keysOf = (objects: Map<string, Buffer>, id: string) =>
  [...objects.keys()].filter((key) => key.endsWith(`/${id}`)).sort();

/** A file made withheld by a real download, so the stale clean/ copy stays as it does in life. */
async function withheldFile(member: Member, objects: Map<string, Buffer>): Promise<string> {
  const id = await cleanFile(member, objects, 100);
  await sender(objects, 'infected')(member, id).catch(() => undefined);
  expect((await row(member.tenant, id))?.scan_state).toBe('withheld');
  return id;
}

describe('a restore racing the sweep', { timeout: 60_000 }, () => {
  it('keeps the restored clean/ object and drops the stale withheld/ copy, in both orders', async () => {
    const { objects } = memory();
    let id = '';
    await bothOrders(
      async () => {
        id = await withheldFile(adminA, objects);
        return [recheckTask(tenantA, objects, 'clean'), sweepTask(tenantA, objects)];
      },
      async () => {
        expect(await row(tenantA, id)).toMatchObject({
          scan_state: 'clean',
          storage_key: `clean/${tenantA.id}/${id}`,
          scan_version: 300,
        });
        expect(objects.get(`clean/${tenantA.id}/${id}`)?.equals(pdf)).toBe(true);
        await sweepTask(tenantA, objects)(idle);
        expect(keysOf(objects, id)).toEqual([`clean/${tenantA.id}/${id}`]);
      },
    );
  });
});

describe('a withhold at download racing the sweep', { timeout: 60_000 }, () => {
  it('keeps the withheld/ copy and drops the stale clean/ one, in both orders', async () => {
    const { objects } = memory();
    let id = '';
    await bothOrders(
      async () => {
        id = await cleanFile(adminA, objects, 100);
        return [withholdTask(objects, adminA, id), sweepTask(tenantA, objects)];
      },
      async () => {
        expect(await row(tenantA, id)).toMatchObject({
          scan_state: 'withheld',
          storage_key: `withheld/${tenantA.id}/${id}`,
        });
        expect(objects.get(`withheld/${tenantA.id}/${id}`)?.equals(pdf)).toBe(true);
        await sweepTask(tenantA, objects)(idle);
        expect(keysOf(objects, id)).toEqual([`withheld/${tenantA.id}/${id}`]);
      },
    );
  });
});

describe('a file that goes clean, withheld, clean and withheld again', { timeout: 60_000 }, () => {
  it('always has the object its row points at, with the sweep racing each change', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 100);
    const steps: [Task, string][] = [
      [withholdTask(objects, adminA, id, 200), 'withheld'],
      [recheckTask(tenantA, objects, 'clean', 300), 'clean'],
      [withholdTask(objects, adminA, id, 400), 'withheld'],
    ];
    for (const [index, [step, state]] of steps.entries()) {
      const sweep = sweepTask(tenantA, objects);
      await (index === 1 ? race(sweep, step) : race(step, sweep));
      const found = await row(tenantA, id);
      expect(found?.scan_state).toBe(state);
      expect(objects.has(found?.storage_key ?? '')).toBe(true);
      await sweepTask(tenantA, objects)(idle);
      expect(keysOf(objects, id)).toEqual([found?.storage_key]);
    }
  });
});

describe('an erasure racing a withhold or a restore', { timeout: 60_000 }, () => {
  it('ends erased with no withheld/ object after the next sweep, in both orders', async () => {
    const { objects } = memory();
    let id = '';
    await bothOrders(
      async () => {
        id = await cleanFile(adminA, objects, 100);
        return [eraseTask(tenantA, id), withholdTask(objects, adminA, id)];
      },
      async () => {
        const found = await row(tenantA, id);
        expect(found).toMatchObject({ storage_key: null, sha256: null });
        expect(found?.scan_state).not.toBe('withheld');
        await sweepTask(tenantA, objects)(idle);
        expect(keysOf(objects, id)).toEqual([]);
      },
    );
  });

  it('ends erased with no clean/ object after the next sweep, in both orders', async () => {
    const { objects } = memory();
    let id = '';
    await bothOrders(
      async () => {
        id = await withheldFile(adminA, objects);
        return [eraseTask(tenantA, id), recheckTask(tenantA, objects, 'clean')];
      },
      async () => {
        expect(await row(tenantA, id)).toMatchObject({ storage_key: null, sha256: null });
        await sweepTask(tenantA, objects)(idle);
        expect(keysOf(objects, id)).toEqual([]);
      },
    );
  });
});

describe('another user of the same tenant', () => {
  it('can download a clean file, and the event names that user and never the file name', async () => {
    const { objects } = memory();
    const id = await cleanFile(adminA, objects, 200);
    const other = await addMember(tenantA, 'console', 'tenant_admin');
    const reply = await sender(objects, 'clean')(other, id);
    expect((await bytesOf(reply)).equals(pdf)).toBe(true);
    const found = (await events(tenantA, 'platform.file.downloaded')).filter(
      (event) => event.entity_id === id,
    );
    expect(found).toMatchObject([{ actor_id: other.membershipId }]);
    expect(JSON.stringify(found)).not.toContain('Accounts');
  });
});

describe('the tenant files job', { timeout: 60_000 }, () => {
  const releasedFile = async (member: Member, objects: Map<string, Buffer>) => {
    const id = await cleanFile(member, objects, 200);
    await asMigratorIn(member.tenant.id, async (client) => {
      await client.query('UPDATE app.file SET linked_at = now() WHERE id = $1', [id]);
      await client.query('UPDATE app.file SET released_at = now() WHERE id = $1', [id]);
    });
    return id;
  };
  const depsOver = (objects: Map<string, Buffer>, lists: string[] = []) => ({
    ...recheckOver(objects, 'clean'),
    removal: removalOver(objects, lists),
  });
  const run = (tenant: TestTenant, deps: ReturnType<typeof depsOver>) =>
    withTenant(worker, trustedTenantId(tenant.id), (trx) =>
      filesHandler(deps).handle(trx, {
        id: randomUUID(),
        data: { slot: randomUUID() },
        context: jobContext(),
      }),
    );

  it('cannot read, lock, delete or restore another tenant’s rows or objects', async () => {
    const { objects } = memory();
    const lists: string[] = [];
    const released = await releasedFile(adminB, objects);
    const withheld = await withheldFile(adminB, objects);
    const orphan = `clean/${tenantB.id}/${randomUUID()}`;
    objects.set(orphan, pdf);
    const before = [...objects.keys()].sort();

    await run(tenantA, depsOver(objects, lists));

    expect(lists).toHaveLength(2);
    expect(lists.every((prefix) => prefix.includes(`/${tenantA.id}/`))).toBe(true);
    expect([...objects.keys()].sort()).toEqual(before);
    expect(await row(tenantB, released)).toBeDefined();
    expect((await row(tenantB, withheld))?.scan_state).toBe('withheld');

    // A's own transaction cannot see, lock or delete them either.
    await withTenant(worker, trustedTenantId(tenantA.id), async (trx) => {
      const seen = await trx
        .$extendTables<{ 'app.file': { id: string } }>()
        .selectFrom('app.file')
        .select('id')
        .where('id', 'in', [released, withheld])
        .forUpdate()
        .execute();
      expect(seen).toEqual([]);
      const gone = await trx
        .selectNoFrom((eb) =>
          eb.fn<boolean>('app.delete_swept_file', [eb.val(released)]).as('gone'),
        )
        .executeTakeFirstOrThrow();
      expect(gone.gone).toBe(false);
    });
    expect(await row(tenantB, released)).toBeDefined();
  });

  it('runs the sweep then the recheck, records counts, and does not hold another tenant’s job back', async () => {
    const { objects } = memory();
    const releasedA = await releasedFile(adminA, objects);
    const releasedB = await releasedFile(adminB, objects);
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => (unblock = resolve));
    const steps: string[] = [];
    const base = depsOver(objects);
    const slow = {
      ...base,
      removal: {
        ...base.removal,
        delete: async (key: string) => {
          steps.push('sweep');
          await blocked;
          await base.removal.delete(key);
        },
      },
      version: () => {
        steps.push('recheck');
        return base.version();
      },
    };
    const first = run(tenantA, slow);
    await sleep(400);
    // A's sweep is still running, so its recheck has not started; B's whole job runs and ends.
    await run(tenantB, depsOver(objects));
    expect(steps).toEqual(['sweep']);
    expect(await row(tenantB, releasedB)).toBeUndefined();
    expect(await row(tenantA, releasedA)).toBeDefined();
    unblock();
    await first;
    expect(steps).toEqual(['sweep', 'recheck']);
    expect(await row(tenantA, releasedA)).toBeUndefined();

    const [sweep] = await events(tenantA, 'platform.file_sweep.completed');

    expect(JSON.stringify(sweep?.changes)).toContain('"after":1');
    expect(await events(tenantA, 'platform.file_recheck.completed')).toHaveLength(1);
  });
});
