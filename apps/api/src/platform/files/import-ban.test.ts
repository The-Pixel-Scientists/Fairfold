// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Semgrep rules tps-no-presigned-urls and tps-storage-keys-only-in-files
// (ADR 0047), checked here too so a local test run catches a stray use before
// CI does: no presigning under apps/, and the storage keys read only here.

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..', '..', '..');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const PRESIGNING =
  /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"`]@aws-sdk\/(?:s3-request-presigner|s3-presigned-post)|\.presign(?:WithCredentials)?\s*\(|\bgetSignedUrl\s*\(|\bcreatePresignedPost\s*\(/;
const SIGNER = /['"`]@smithy\/signature-v4/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/g;
const STORAGE_KEYS = /TPS_STORAGE_(?:WRITE|READ)_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)/;
const THIS_FOLDER = 'apps/api/src/platform/files/';
const FOLDER = 'platform/files/';
const INDEX = /^index(?:\.[cm]?[jt]s)?$/;

/**
 * True if an import, export-from, dynamic import or require in `text` (the
 * source of repo-relative `path`) reaches into the file service other than
 * through its index. A relative specifier is resolved against the importing
 * file first, so `../files/storage.ts` from a sibling folder is caught.
 */
export function reachesPastIndex(path: string, text: string): boolean {
  return [...text.matchAll(SPECIFIER)].some(([, , specifier = '']) => {
    const target = specifier.startsWith('.')
      ? posix.join(posix.dirname(path), specifier)
      : specifier;
    const at = `${target}/`.indexOf(FOLDER);
    if (at === -1) return false;
    const rest = target.slice(at + FOLDER.length);
    return rest !== '' && !INDEX.test(rest);
  });
}

function* sources(folder: string): Generator<string> {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (SOURCE.test(entry.name)) yield path;
  }
}

const files = (group: string) =>
  [...sources(join(root, group))].map((path) => ({
    path: relative(root, path).split(sep).join('/'),
    text: () => readFileSync(path, 'utf8'),
  }));

describe('file storage', () => {
  it('has no presigning function imported or called under apps/', { timeout: 30_000 }, () => {
    const found = files('apps')
      .filter(({ path }) => path !== `${THIS_FOLDER}import-ban.test.ts`)
      .filter(({ text }) => PRESIGNING.test(text()))
      .map(({ path }) => path);
    expect(found).toEqual([]);
  });

  it('has its signer and storage keys only in the file service', { timeout: 30_000 }, () => {
    const found = [...files('apps'), ...files('modules'), ...files('packages')]
      .filter(({ path }) => !path.startsWith(THIS_FOLDER))
      .filter(({ text }) => {
        const source = text();
        return SIGNER.test(source) || STORAGE_KEYS.test(source);
      })
      .map(({ path }) => path);
    expect(found).toEqual([]);
  });

  it('is imported from outside only through its index', { timeout: 30_000 }, () => {
    const found = [...files('apps'), ...files('modules'), ...files('packages')]
      .filter(({ path }) => !path.startsWith(THIS_FOLDER))
      .filter(({ path, text }) => reachesPastIndex(path, text()))
      .map(({ path }) => path);
    expect(found).toEqual([]);
  });

  it('catches every way past the index, however the path is written', () => {
    const past: [string, string][] = [
      ['apps/api/src/app.ts', "import { createStorage } from './platform/files/storage.ts';"],
      ['apps/api/src/routes/a.ts', "import { x } from '../platform/files/storage.ts';"],
      [
        'apps/api/src/platform/audit-log/a.ts',
        "import { createStorage } from '../files/storage.ts';",
      ],
      ['apps/api/src/platform/settings/a.ts', "export * from '../files/sign.ts';"],
      ['apps/api/src/platform/members.ts', "import { sign } from './files/sign.ts';"],
      ['apps/api/src/platform/x/y/a.ts', 'export { a } from "../../files/settings.js";'],
      ['apps/api/src/platform/members.ts', "const m = await import('./files/store.ts');"],
      ['apps/api/src/platform/members.ts', "const m = require('./files/send');"],
      ['apps/api/src/platform/members.ts', "import './files/clamd.ts';"],
      ['apps/api/src/routes/a.ts', "import { x } from '#api/platform/files/storage.ts';"],
    ];
    for (const [path, text] of past) expect(reachesPastIndex(path, text), text).toBe(true);
    const allowed: [string, string][] = [
      ['apps/api/src/app.ts', "import type { X } from './platform/files/index.ts';"],
      ['apps/api/src/app.ts', "import { x } from './platform/files';"],
      ['apps/api/src/platform/members.ts', "import { x } from './files/index.ts';"],
      ['apps/api/src/platform/members.ts', "import { x } from './files';"],
      ['apps/api/src/platform/settings/a.ts', "export * from '../files/index.js';"],
      ['apps/api/src/platform/settings/a.ts', "import { x } from '../files-other/storage.ts';"],
      ['apps/api/src/platform/members.ts', "import { x } from './members-files/storage.ts';"],
    ];
    for (const [path, text] of allowed) expect(reachesPastIndex(path, text), text).toBe(false);
  });
});
