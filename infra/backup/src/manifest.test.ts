// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';

import { BackupError } from './codes.ts';
import {
  buildIndex,
  buildManifest,
  FORMAT_VERSION,
  parseIndex,
  snapshotIdOfManifest,
  type ObjectRef,
  type SnapshotParts,
} from './manifest.ts';
import { describe, it } from './testing.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const ID = '20270101T020000Z-ab12';

const ref = (key: string): ObjectRef => ({
  key,
  versionId: 'v1',
  sha256: 'a'.repeat(64),
  size: 123,
  keyId: 'backup-2026-1',
});

function parts(): SnapshotParts {
  const live = {
    tenantId: TENANT,
    fileId: FILE,
    storageKey: `clean/${TENANT}/${FILE}`,
    contentSha256: 'b'.repeat(64),
    contentSize: 99,
    // A row carrying a name must not leak into either document.
    name: 'jane-doe-passport.pdf',
  };
  return {
    snapshotId: ID,
    startedAt: new Date('2027-01-01T02:00:00Z'),
    tier: 'yearly',
    retainUntil: new Date('2034-01-01T02:00:00Z'),
    keyId: 'backup-2026-1',
    versions: {
      migration: '0045_x',
      rolesScript: '5',
      postgres: '16.4',
      pgDump: '17.2',
    },
    dumps: [{ database: 'grants', object: ref(`dumps/${ID}/grants.dump.age`) }],
    keySnapshot: ref(`key-snapshots/${ID}.age`),
    files: [
      {
        live,
        held: {
          tenantId: TENANT,
          fileId: FILE,
          object: ref(`files/${TENANT}/${FILE}/${ID}.age`),
          lockUntil: '2034-01-01T02:00:00.000Z',
        },
      },
    ],
  };
}

describe('buildManifest', () => {
  it('holds the format version, versions, key id, tier and retain-until date', () => {
    const manifest = JSON.parse(buildManifest(parts())) as Record<string, unknown>;
    assert.equal(manifest['formatVersion'], FORMAT_VERSION);
    assert.equal(manifest['tier'], 'yearly');
    assert.equal(manifest['retainUntil'], '2034-01-01T02:00:00.000Z');
    assert.equal(manifest['keyId'], 'backup-2026-1');
    assert.deepEqual(manifest['versions'], parts().versions);
  });

  it('lists every object with its hash, size and key version', () => {
    const text = buildManifest(parts());
    const manifest = JSON.parse(text) as {
      dumps: { object: ObjectRef }[];
      keySnapshot: ObjectRef;
      files: { contentSha256: string; contentSize: number; object: ObjectRef }[];
    };
    for (const object of [
      manifest.dumps[0]?.object,
      manifest.keySnapshot,
      manifest.files[0]?.object,
    ]) {
      assert.equal(object?.keyId, 'backup-2026-1');
      assert.equal(object.size, 123);
      assert.equal(object.sha256, 'a'.repeat(64));
    }
    assert.equal(manifest.files[0]?.contentSha256, 'b'.repeat(64));
    assert.equal(manifest.files[0].contentSize, 99);
  });

  it('never carries a file name', () => {
    assert.doesNotMatch(buildManifest(parts()), /jane-doe|passport/);
    assert.doesNotMatch(buildIndex(parts()), /jane-doe|passport/);
  });
});

describe('buildIndex', () => {
  it('holds no hash of file content, and leaves out the key snapshot', () => {
    const text = buildIndex(parts());
    assert.doesNotMatch(text, /contentSha256|b{64}/);
    assert.doesNotMatch(text, /key-snapshots/);
  });

  it('round-trips through parseIndex', () => {
    const index = parseIndex(buildIndex(parts()), ID);
    assert.equal(index.files[0]?.fileId, FILE);
    assert.equal(index.dumps[0]?.key, `dumps/${ID}/grants.dump.age`);
  });
});

describe('parseIndex', () => {
  const refused = (text: string, id = ID) => {
    assert.throws(
      () => parseIndex(text, id),
      (error: unknown) => error instanceof BackupError && error.code === 'index_invalid',
    );
  };

  it('refuses text that is not JSON', () => {
    refused('{not json');
  });

  it('refuses a format it does not know', () => {
    refused(JSON.stringify({ ...JSON.parse(buildIndex(parts())), formatVersion: 2 }));
  });

  it('refuses an index for another snapshot', () => {
    refused(buildIndex(parts()), '20270102T020000Z-ab12');
  });

  it('refuses a malformed reference', () => {
    const index = JSON.parse(buildIndex(parts())) as { files: { fileId: string }[] };
    (index.files[0] as { fileId: string }).fileId = '../other';
    refused(JSON.stringify(index));
  });
});

describe('snapshotIdOfManifest', () => {
  it('reads the id from a manifest key', () => {
    assert.equal(snapshotIdOfManifest(`manifests/${ID}.age`), ID);
  });

  it('ignores any other key', () => {
    assert.equal(snapshotIdOfManifest(`manifests/${ID}.json`), undefined);
    assert.equal(snapshotIdOfManifest('manifests/not-an-id.age'), undefined);
  });
});
