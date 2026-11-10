// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { BACKUP_ROLE } from '../../../packages/db/scripts/roles.ts';

import { BackupError } from './codes.ts';
import { runBackup, withScratch, type JobInput, type RunRecord } from './job.ts';
import { assertRecipients } from './checks.ts';
import type { LiveFile } from './plan.ts';
import type { ObjectStore, ObjectVersion } from './store.ts';
import type { Identity } from './commands.ts';
import { holdSnapshot, type Tools } from './tools.ts';
import { describe, it } from './testing.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const fileId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const live = (n: number): LiveFile => ({
  tenantId: TENANT,
  fileId: fileId(n),
  storageKey: `clean/${TENANT}/${fileId(n)}`,
  contentSha256: 'a'.repeat(64),
  contentSize: 10,
});

interface Stored {
  version: ObjectVersion;
  body: string;
  until: Date;
}

/** Behaves as a store with compliance locks: a lock only lengthens, and blocks deletion. */
class FakeStore implements ObjectStore {
  objects: Stored[] = [];
  writes: string[] = [];
  locked = true;
  retentionWorks = true;
  corruptReads = false;
  now: () => Date = () => new Date(0);
  #next = 0;

  isLocked() {
    return Promise.resolve(this.locked);
  }

  put(key: string, file: string, until: Date) {
    const versionId = `v${String((this.#next += 1))}`;
    for (const object of this.objects) {
      if (object.version.key === key) object.version.isLatest = false;
    }
    this.objects.push({
      version: { key, versionId, isLatest: true },
      body: readFileSync(file, 'utf8'),
      until,
    });
    this.writes.push(key);
    return Promise.resolve(versionId);
  }

  find(key: string, versionId: string): Stored {
    const found = this.objects.find(
      (object) => object.version.key === key && object.version.versionId === versionId,
    );
    assert.ok(found, `no object ${key}`);
    return found;
  }

  byPrefix(prefix: string): Stored[] {
    return this.objects.filter((object) => object.version.key.startsWith(prefix));
  }

  get(key: string, versionId: string, file: string) {
    writeFileSync(file, this.corruptReads ? 'corrupt' : this.find(key, versionId).body);
    return Promise.resolve();
  }

  retention(key: string, versionId: string): ReturnType<ObjectStore['retention']> {
    if (!this.retentionWorks) return Promise.resolve(null);
    return Promise.resolve({ mode: 'COMPLIANCE', until: this.find(key, versionId).until });
  }

  extend(key: string, versionId: string, until: Date) {
    const object = this.find(key, versionId);
    assert.ok(until.getTime() >= object.until.getTime(), 'a lock may never be shortened');
    object.until = until;
    return Promise.resolve();
  }

  listVersions(prefix: string) {
    return Promise.resolve(this.byPrefix(prefix).map((object) => object.version));
  }

  remove(key: string, versionId: string) {
    const object = this.find(key, versionId);
    assert.ok(object.until.getTime() <= this.now().getTime(), 'a locked object cannot be removed');
    this.objects.splice(this.objects.indexOf(object), 1);
    return Promise.resolve();
  }
}

const goodIdentity: Identity = {
  user: BACKUP_ROLE,
  sessionUser: BACKUP_ROLE,
  exempt: true,
  serverVersionNum: 160004,
  serverVersion: '16.4',
  rolesScript: '5',
  migration: '0045_app_x',
};

function fakeTools(files: () => LiveFile[], overrides: Partial<Tools> = {}): Tools {
  return {
    identity: () => Promise.resolve(goodIdentity),
    pgDumpVersion: () => Promise.resolve({ major: 17, version: '17.2' }),
    openSnapshot: () =>
      Promise.resolve({
        id: '00000003-1B-1',
        files: () => Promise.resolve(files()),
        close: () => Promise.resolve(),
      }),
    dump: (_database, _snapshot, output) => {
      writeFileSync(output, 'encrypted dump');
      return Promise.resolve();
    },
    dumpKeys: (_snapshot, output) => {
      writeFileSync(output, 'encrypted keys');
      return Promise.resolve();
    },
    copyFile: (_file, output) => {
      writeFileSync(output, 'encrypted file');
      return Promise.resolve();
    },
    encrypt: (text, output) => {
      writeFileSync(output, text);
      return Promise.resolve();
    },
    ...overrides,
  };
}

describe('runBackup', () => {
  let scratch: string;
  let store: FakeStore;
  let files: LiveFile[];
  let suffix = 0;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'backup-job-test-'));
    store = new FakeStore();
    files = [live(1)];
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function input(at: string, overrides: Partial<JobInput> = {}): JobInput {
    suffix += 1;
    const moment = new Date(at);
    store.now = () => moment;
    return {
      store,
      tools: fakeTools(() => files),
      scratch,
      applicationDatabase: 'grants',
      otherDatabases: ['metadata'],
      keyId: 'backup-2026-1',
      recipients: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\n',
      now: () => moment,
      suffix: suffix.toString(16).padStart(4, '0'),
      ...overrides,
    };
  }

  const run = (at: string, overrides?: Partial<JobInput>): Promise<RunRecord> =>
    runBackup(input(at, overrides));

  const NIGHT = '2026-11-08T02:00:00Z';

  it('writes every object, with the manifest last', async () => {
    const record = await run(NIGHT);
    assert.equal(record.outcome, 'ok');
    assert.equal(record.tier, 'daily');
    assert.equal(record.filesCopied, 1);
    assert.equal(store.byPrefix('dumps/').length, 2);
    assert.equal(store.byPrefix('key-snapshots/').length, 1);
    assert.equal(store.byPrefix('files/').length, 1);
    const last = store.writes.filter((key) => !key.startsWith('runs/')).at(-1);
    assert.match(last ?? '', /^manifests\//);
  });

  it('copies only new files on the next night and keeps earlier locks extended', async () => {
    await run(NIGHT);
    files = [live(1), live(2)];
    const record = await run('2026-11-09T02:00:00Z');
    assert.equal(record.filesCopied, 1);
    assert.equal(record.filesHeld, 1);
    const [first] = store.byPrefix(`files/${TENANT}/${fileId(1)}/`);
    assert.equal(first?.until.toISOString(), '2026-12-14T02:00:00.000Z');
    assert.equal(store.byPrefix(`files/${TENANT}/${fileId(1)}/`).length, 1);
  });

  it('copies what a missed night added', async () => {
    await run(NIGHT);
    files = [live(1), live(2), live(3)];
    const record = await run('2026-11-10T02:00:00Z');
    assert.equal(record.filesCopied, 2);
    assert.equal(record.tier, 'daily');
  });

  it('locks a yearly snapshot for 7 years, and files for 7, but keys for 35 days only', async () => {
    const record = await run('2027-01-01T02:00:00Z');
    assert.equal(record.tier, 'yearly');
    const until = (prefix: string) => store.byPrefix(prefix)[0]?.until.toISOString();
    assert.equal(until('dumps/'), '2034-01-01T02:00:00.000Z');
    assert.equal(until('files/'), '2034-01-01T02:00:00.000Z');
    assert.equal(until('manifests/'), '2034-01-01T02:00:00.000Z');
    assert.equal(until('key-snapshots/'), '2027-02-05T02:00:00.000Z');
  });

  it('never shortens a file lock set by an earlier yearly snapshot', async () => {
    await run('2027-01-01T02:00:00Z');
    await run('2027-01-02T02:00:00Z');
    const [file] = store.byPrefix('files/');
    assert.equal(file?.until.toISOString(), '2034-01-01T02:00:00.000Z');
  });

  it('skips a re-run on a day that already has a manifest', async () => {
    await run(NIGHT);
    const before = store.byPrefix('dumps/').length;
    const record = await run('2026-11-08T09:40:00Z');
    assert.equal(record.outcome, 'already_complete');
    assert.equal(store.byPrefix('dumps/').length, before);
  });

  it('completes a re-run after a failed run on the same day, leaving 35-day leftovers', async () => {
    const failed = await run('2027-01-01T02:00:00Z', {
      tools: fakeTools(() => files, {
        copyFile: () => Promise.reject(new BackupError('source_failed')),
      }),
    });
    assert.equal(failed.outcome, 'source_failed');
    assert.equal(store.byPrefix('manifests/').length, 0);
    assert.equal(store.byPrefix('dumps/')[0]?.until.toISOString(), '2027-02-05T02:00:00.000Z');
    const retried = await run('2027-01-01T09:40:00Z');
    assert.equal(retried.outcome, 'ok');
    assert.equal(store.byPrefix('manifests/').length, 1);
  });

  const refusals: [string, Partial<Identity>, string][] = [
    ['another role', { user: 'app_api', sessionUser: 'app_api' }, 'role_refused'],
    ['the backup role through SET ROLE', { sessionUser: 'migrator' }, 'role_refused'],
    ['a role without the exemption', { exempt: false }, 'role_not_exempt'],
    ['a missing roles version', { rolesScript: null }, 'role_refused'],
    ['an old server', { serverVersionNum: 150000 }, 'postgres_too_old'],
    ['a pg_dump older than the server', { serverVersionNum: 180001 }, 'pg_dump_too_old'],
  ];

  for (const [name, identity, code] of refusals) {
    it(`refuses ${name} and writes nothing`, async () => {
      const record = await run(NIGHT, {
        tools: fakeTools(() => files, {
          identity: () => Promise.resolve({ ...goodIdentity, ...identity }),
        }),
      });
      assert.equal(record.outcome, code);
      assert.deepEqual(store.writes, []);
    });
  }

  it('stops without writing if the bucket has no object lock', async () => {
    store.locked = false;
    const record = await run(NIGHT);
    assert.equal(record.outcome, 'bucket_lock_missing');
    assert.deepEqual(store.writes, []);
  });

  it('stops with no snapshot if the probe lock cannot be read back', async () => {
    store.retentionWorks = false;
    const record = await run(NIGHT);
    assert.equal(record.outcome, 'probe_failed');
    assert.equal(store.byPrefix('dumps/').length, 0);
    assert.equal(store.byPrefix('runs/').length, 0);
  });

  it('refuses a recipients file holding a private key', async () => {
    const record = await run(NIGHT, { recipients: 'AGE-SECRET-KEY-1ABC\n' });
    assert.equal(record.outcome, 'recipients_invalid');
    assert.deepEqual(store.writes, []);
  });

  it('fails with no manifest when an upload reads back differently', async () => {
    const tools = fakeTools(() => files);
    const realGet = store.get.bind(store);
    store.get = (key, versionId, file) => {
      store.corruptReads = key.startsWith('dumps/');
      return realGet(key, versionId, file);
    };
    const record = await run(NIGHT, { tools });
    assert.equal(record.outcome, 'upload_mismatch');
    assert.equal(store.byPrefix('manifests/').length, 0);
  });

  it('fails with no manifest when a file does not match its hash', async () => {
    const record = await run(NIGHT, {
      tools: fakeTools(() => files, {
        copyFile: () => Promise.reject(new BackupError('file_hash_mismatch')),
      }),
    });
    assert.equal(record.outcome, 'file_hash_mismatch');
    assert.equal(store.byPrefix('manifests/').length, 0);
  });

  it('records a run record of codes and counts only', async () => {
    files = [{ ...live(1) }];
    const record = await run(NIGHT);
    const [stored] = store.byPrefix('runs/');
    assert.deepEqual(JSON.parse(stored?.body ?? '{}'), record);
    assert.deepEqual(Object.keys(record).sort(), [
      'bytes',
      'filesCopied',
      'filesHeld',
      'locksExtended',
      'objects',
      'outcome',
      'pruned',
      'runId',
      'tier',
    ]);
    assert.doesNotMatch(stored?.body ?? '', /clean\/|tenant|password/i);
  });

  it('fails with its code and removes the scratch directory if the snapshot holder dies', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'backup-holder-test-'));
    const dyingHolder = {
      path: process.execPath,
      args: ['-e', 'process.stdout.write("00000003-1B-1\\n", () => process.exit(1))'],
      env: {},
      failure: 'database_failed' as const,
    };
    let record: RunRecord | undefined;
    let used = '';
    await withScratch(parent, async (dir) => {
      used = dir;
      writeFileSync(join(dir, 'pgpass'), 'password');
      record = await run(NIGHT, {
        scratch: dir,
        tools: fakeTools(() => files, {
          openSnapshot: async () => ({
            ...(await holdSnapshot(dyingHolder)),
            files: () => Promise.resolve(files),
          }),
          // Long enough for the holder to exit before the job closes it.
          dump: async () => {
            await sleep(500);
            throw new BackupError('dump_failed');
          },
        }),
      });
    });
    rmSync(parent, { recursive: true, force: true });
    assert.equal(record?.outcome, 'database_failed');
    assert.equal(store.byPrefix('runs/').length, 1);
    assert.equal(existsSync(used), false);
  });

  describe('prune', () => {
    it('leaves an expired run record alone, under a credential that cannot touch one', async () => {
      const first = await run(NIGHT);
      const denied = (key: string) => key.startsWith('runs/');
      const remove = store.remove.bind(store);
      store.remove = (key, versionId) =>
        denied(key) ? Promise.reject(new BackupError('store_failed')) : remove(key, versionId);
      const retention = store.retention.bind(store);
      store.retention = (key, versionId) =>
        denied(key) ? Promise.reject(new BackupError('store_failed')) : retention(key, versionId);
      const record = await run('2027-12-02T02:00:00Z');
      assert.equal(record.outcome, 'ok');
      assert.ok(record.pruned > 0);
      assert.equal(store.byPrefix(`runs/${first.runId}`).length, 1);
    });

    it('never removes a file a live yearly manifest references, even past its own lock', async () => {
      await run('2027-01-01T02:00:00Z');
      const [file] = store.byPrefix('files/');
      assert.ok(file);
      file.until = new Date('2027-02-01T00:00:00Z');
      const record = await run('2027-03-05T02:00:00Z');
      assert.equal(record.outcome, 'ok');
      assert.ok(store.byPrefix('files/').includes(file));
    });

    it('never removes a file a live monthly manifest references', async () => {
      await run('2027-02-01T02:00:00Z');
      files = [];
      const [file] = store.byPrefix('files/');
      assert.ok(file);
      file.until = new Date('2027-03-01T00:00:00Z');
      await run('2027-03-15T02:00:00Z');
      assert.ok(store.byPrefix('files/').includes(file));
    });

    it('removes objects past their lock that no live manifest references', async () => {
      await run(NIGHT);
      files = [];
      await run('2026-12-20T02:00:00Z');
      assert.equal(store.byPrefix('files/').length, 0);
      assert.equal(store.byPrefix(`dumps/20261108`).length, 0);
    });

    it('lets a key snapshot go after 35 days, even under a live yearly manifest', async () => {
      await run('2027-01-01T02:00:00Z');
      await run('2027-02-10T02:00:00Z');
      assert.equal(store.byPrefix('key-snapshots/20270101').length, 0);
      assert.equal(store.byPrefix('key-snapshots/20270210').length, 1);
    });

    it('stops before copying anything if the newest index is unreadable', async () => {
      await run('2027-01-01T02:00:00Z');
      for (const object of store.byPrefix('indexes/')) object.body = 'not json';
      const objects = store.objects.length;
      const record = await run('2027-03-05T02:00:00Z');
      assert.equal(record.outcome, 'index_invalid');
      assert.equal(store.byPrefix('files/').length, 1);
      assert.ok(store.objects.length >= objects);
    });

    it('reports prune_failed when an index cannot be read during prune', async () => {
      await run('2027-01-01T02:00:00Z');
      await run('2027-01-02T02:00:00Z');
      const original = store.listVersions.bind(store);
      store.listVersions = (prefix) =>
        prefix.startsWith('indexes/20270101') ? Promise.resolve([]) : original(prefix);
      const record = await run('2027-01-03T02:00:00Z');
      assert.equal(record.outcome, 'prune_failed');
      assert.equal(store.byPrefix('manifests/').length, 3);
    });
  });
});

describe('assertRecipients', () => {
  it('accepts public recipients and comments', () => {
    assertRecipients('# backup-2026-1\nage1abc\n\nage1def\n');
  });

  it('refuses an empty list', () => {
    assert.throws(() => {
      assertRecipients('# nothing\n');
    }, BackupError);
  });

  it('refuses a private key', () => {
    assert.throws(() => {
      assertRecipients('AGE-SECRET-KEY-1ABCDEF\n');
    }, BackupError);
  });
});
