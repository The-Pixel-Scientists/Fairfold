// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';

import { BackupError } from './codes.ts';
import type { Settings, StoreSettings } from './settings.ts';
import { createStore, sourceStage, type Exec } from './store.ts';
import { describe, it } from './testing.ts';

const STORE: StoreSettings = {
  endpoint: 'https://store.example',
  region: 'uk-1',
  bucket: 'backups',
  credentialsFile: '/run/secrets/store',
};

function recording(responses: Record<string, unknown> = {}) {
  const calls: string[][] = [];
  const exec: Exec = (args) => {
    calls.push([...args]);
    const reply = responses[args[1] ?? ''];
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(reply === undefined ? '' : JSON.stringify(reply));
  };
  return { calls, store: createStore(STORE, exec) };
}

const LOCKED = {
  'get-bucket-versioning': { Status: 'Enabled' },
  'get-object-lock-configuration': { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } },
};

describe('isLocked', () => {
  it('needs versioning and object lock both on', async () => {
    assert.equal(await recording(LOCKED).store.isLocked(), true);
    assert.equal(
      await recording({
        ...LOCKED,
        'get-bucket-versioning': { Status: 'Suspended' },
      }).store.isLocked(),
      false,
    );
    assert.equal(
      await recording({ ...LOCKED, 'get-object-lock-configuration': {} }).store.isLocked(),
      false,
    );
  });
});

describe('put', () => {
  it('sends a compliance lock and the key id, and returns the version', async () => {
    const { calls, store } = recording({ 'put-object': { VersionId: 'v9' } });
    const versionId = await store.put(
      'dumps/x',
      '/scratch/dump',
      new Date('2027-01-01T02:00:00Z'),
      'backup-2026-1',
    );
    assert.equal(versionId, 'v9');
    assert.deepEqual(calls[0], [
      's3api',
      'put-object',
      '--bucket',
      'backups',
      '--key',
      'dumps/x',
      '--body',
      '/scratch/dump',
      '--object-lock-mode',
      'COMPLIANCE',
      '--object-lock-retain-until-date',
      '2027-01-01T02:00:00.000Z',
      '--metadata',
      'key-id=backup-2026-1',
      '--endpoint-url',
      'https://store.example',
      '--region',
      'uk-1',
      '--output',
      'json',
    ]);
  });

  it('fails when the store returns no version id', async () => {
    const { store } = recording({ 'put-object': {} });
    await assert.rejects(store.put('k', '/f', new Date(0), 'k1'), BackupError);
  });
});

describe('retention', () => {
  it('reads the mode and date', async () => {
    const { store } = recording({
      'get-object-retention': {
        Retention: { Mode: 'COMPLIANCE', RetainUntilDate: '2027-01-01T02:00:00+00:00' },
      },
    });
    assert.deepEqual(await store.retention('k', 'v1'), {
      mode: 'COMPLIANCE',
      until: new Date('2027-01-01T02:00:00Z'),
    });
  });

  it('is null when there is no lock or the store will not say', async () => {
    assert.equal(await recording({ 'get-object-retention': {} }).store.retention('k', 'v'), null);
    assert.equal(
      await recording({ 'get-object-retention': new Error('denied') }).store.retention('k', 'v'),
      null,
    );
  });
});

describe('extend', () => {
  it('only ever sets a compliance lock on a named version', async () => {
    const { calls, store } = recording();
    await store.extend('k', 'v1', new Date('2034-01-01T02:00:00Z'));
    assert.deepEqual(calls[0]?.slice(0, 2), ['s3api', 'put-object-retention']);
    assert.ok(calls[0].includes('Mode=COMPLIANCE,RetainUntilDate=2034-01-01T02:00:00.000Z'));
    assert.ok(calls[0].includes('v1'));
  });
});

describe('remove', () => {
  it('names a version and never bypasses a lock', async () => {
    const { calls, store } = recording();
    await store.remove('k', 'v1');
    assert.ok(calls[0]?.includes('v1'));
    assert.ok(!calls[0]?.some((arg) => arg.includes('bypass')));
  });
});

describe('listVersions', () => {
  it('reads versions and treats an empty reply as none', async () => {
    const { store } = recording({
      'list-object-versions': {
        Versions: [{ Key: 'a', VersionId: 'v1', IsLatest: true }],
      },
    });
    assert.deepEqual(await store.listVersions('a'), [
      { key: 'a', versionId: 'v1', isLatest: true },
    ]);
    assert.deepEqual(await recording().store.listVersions('a'), []);
  });

  it('fails on a reply it cannot read', async () => {
    const { store } = recording({ 'list-object-versions': { Versions: 'nope' } });
    await assert.rejects(store.listVersions('a'), BackupError);
  });

  it('fails when the client prints something other than JSON', async () => {
    const store = createStore(STORE, () => Promise.resolve('not json'));
    await assert.rejects(store.listVersions('a'), BackupError);
  });
});

describe('sourceStage', () => {
  const settings = {
    tools: { s3: '/usr/bin/s3' },
    source: { ...STORE, bucket: 'files', credentialsFile: '/run/secrets/source' },
  } as unknown as Settings;
  const key = `clean/${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}/${'2'.repeat(8)}-2222-4222-8222-${'2'.repeat(12)}`;

  it('reads only an exact clean key, and only names the credentials file', () => {
    const stage = sourceStage(settings, '/scratch', key);
    assert.deepEqual(stage.args.slice(0, 4), ['s3', 'cp', `s3://files/${key}`, '-']);
    assert.equal(stage.env['AWS_SHARED_CREDENTIALS_FILE'], '/run/secrets/source');
    assert.ok(!Object.keys(stage.env).includes('AWS_SECRET_ACCESS_KEY'));
  });

  it('refuses any other key', () => {
    assert.throws(() => sourceStage(settings, '/scratch', 'quarantine/x'), BackupError);
  });
});
