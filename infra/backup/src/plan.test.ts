// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';

import { BackupError } from './codes.ts';
import type { HeldFile, ReferenceIndex } from './manifest.ts';
import {
  assertCleanKey,
  diffFiles,
  isReferenced,
  liveReferences,
  needsExtension,
  prunable,
  type LiveFile,
} from './plan.ts';
import { describe, it } from './testing.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const fileId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;

function live(n: number): LiveFile {
  return {
    tenantId: TENANT,
    fileId: fileId(n),
    storageKey: `clean/${TENANT}/${fileId(n)}`,
    contentSha256: 'a'.repeat(64),
    contentSize: 10,
  };
}

function held(n: number, lockUntil = '2027-01-01T00:00:00.000Z'): HeldFile {
  return {
    tenantId: TENANT,
    fileId: fileId(n),
    object: {
      key: `files/${TENANT}/${fileId(n)}/20261108T020000Z-aa.age`,
      versionId: `v${n}`,
      sha256: 'b'.repeat(64),
      size: 20,
      keyId: 'k1',
    },
    lockUntil,
  };
}

describe('assertCleanKey', () => {
  it('accepts an exact clean key', () => {
    assertCleanKey(`clean/${TENANT}/${fileId(1)}`);
  });

  for (const key of [
    `quarantine/${TENANT}/${fileId(1)}`,
    `withheld/${TENANT}/${fileId(1)}`,
    `clean/${TENANT}/../quarantine/${fileId(1)}`,
    `clean/${TENANT}`,
    `/clean/${TENANT}/${fileId(1)}`,
  ]) {
    it(`refuses ${key.slice(0, 16)}`, () => {
      assert.throws(
        () => {
          assertCleanKey(key);
        },
        (error: unknown) => error instanceof BackupError && error.code === 'file_key_refused',
      );
    });
  }
});

describe('diffFiles', () => {
  it('copies only files the last complete snapshot lacks', () => {
    const { toCopy, kept } = diffFiles([live(1), live(2)], [held(1)]);
    assert.deepEqual(
      toCopy.map((file) => file.fileId),
      [fileId(2)],
    );
    assert.deepEqual(
      kept.map(({ held: file }) => file.object.versionId),
      ['v1'],
    );
  });

  it('copies everything added over a missed night in the next run', () => {
    const { toCopy } = diffFiles([live(1), live(2), live(3)], [held(1)]);
    assert.equal(toCopy.length, 2);
  });

  it('copies everything when there is no earlier snapshot', () => {
    assert.equal(diffFiles([live(1), live(2)], []).toCopy.length, 2);
  });

  it('leaves out a file no longer live', () => {
    const { toCopy, kept } = diffFiles([live(1)], [held(1), held(9)]);
    assert.equal(toCopy.length, 0);
    assert.equal(kept.length, 1);
  });
});

describe('needsExtension', () => {
  it('extends a lock only when the wanted date is later', () => {
    assert.equal(
      needsExtension('2027-01-01T00:00:00.000Z', new Date('2027-01-02T00:00:00Z')),
      true,
    );
  });

  it('never shortens a lock', () => {
    assert.equal(
      needsExtension('2034-01-01T00:00:00.000Z', new Date('2027-01-02T00:00:00Z')),
      false,
    );
  });

  it('leaves an equal lock alone', () => {
    assert.equal(
      needsExtension('2027-01-02T00:00:00.000Z', new Date('2027-01-02T00:00:00Z')),
      false,
    );
  });
});

describe('prune', () => {
  const now = new Date('2027-06-01T00:00:00Z');
  const past = new Date('2027-05-01T00:00:00Z');
  const future = new Date('2030-01-01T00:00:00Z');

  const index = (files: HeldFile[]): ReferenceIndex => ({
    snapshotId: '20270101T020000Z-aa',
    dumps: [
      {
        key: 'dumps/20270101T020000Z-aa/app.dump.age',
        versionId: 'd1',
        sha256: 'c'.repeat(64),
        size: 5,
        keyId: 'k1',
      },
    ],
    files,
  });

  it('never prunes a file a live monthly or yearly manifest references, even past its lock', () => {
    const refs = liveReferences([index([held(1)])]);
    const { key, versionId } = held(1).object;
    assert.deepEqual(prunable([{ key, versionId, retainUntil: past }], refs, now), []);
  });

  it('removes an unreferenced object once its lock has expired', () => {
    const refs = liveReferences([index([])]);
    const candidate = { key: held(2).object.key, versionId: 'v2', retainUntil: past };
    assert.deepEqual(prunable([candidate], refs, now), [candidate]);
  });

  it('keeps an unreferenced object still locked, or with no readable lock', () => {
    const refs = liveReferences([]);
    const { key } = held(2).object;
    assert.deepEqual(
      prunable(
        [
          { key, versionId: 'a', retainUntil: future },
          { key, versionId: 'b', retainUntil: null },
        ],
        refs,
        now,
      ),
      [],
    );
  });

  it('treats each version separately', () => {
    const refs = liveReferences([index([held(1)])]);
    const { key } = held(1).object;
    assert.equal(isReferenced(refs, { key, versionId: 'v1' }), true);
    assert.equal(isReferenced(refs, { key, versionId: 'older' }), false);
  });

  it('references the dump as well as the files', () => {
    const refs = liveReferences([index([])]);
    assert.equal(
      isReferenced(refs, { key: 'dumps/20270101T020000Z-aa/app.dump.age', versionId: 'd1' }),
      true,
    );
  });
});
