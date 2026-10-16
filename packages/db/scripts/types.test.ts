// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compareFolder, generateTypes, parseArguments, readFolder, writeFolder } from './types.ts';

describe('parseArguments', () => {
  it('writes by default and compares with --check', () => {
    expect(parseArguments([])).toEqual({ check: false });
    expect(parseArguments(['--check'])).toEqual({ check: true });
    expect(parseArguments(['--', '--check'])).toEqual({ check: true });
  });

  it('refuses any other argument', () => {
    expect(() => parseArguments(['--fix'])).toThrow('Unknown argument --fix. Use --check');
    expect(() => parseArguments(['app'])).toThrow('Unknown argument app.');
  });
});

describe('generateTypes', () => {
  const env = {
    TPS_DEV: '1',
    TPS_DB_HOST: '127.0.0.1',
    TPS_DB_PORT: '5432',
    TPS_DB_MIGRATOR_PASSWORD: 'dev-migrator-password-not-a-secret',
    TPS_DEV_DATABASES: 'tps_w,tps_w_test',
  };

  it("refuses a database that is not this worktree's before connecting", async () => {
    await expect(generateTypes({ ...env, TPS_DB_NAME: 'grants' })).rejects.toThrow(
      'Refusing to read types from grants: its name does not start with tps_.',
    );
    await expect(generateTypes({ ...env, TPS_DB_NAME: 'tps_other' })).rejects.toThrow(
      "it is not this worktree's database",
    );
    await expect(
      generateTypes({ ...env, TPS_DB_NAME: 'tps_w', TPS_DB_HOST: 'db.example.org' }),
    ).rejects.toThrow('works only on this machine');
  });
});

describe('compareFolder', () => {
  const generated = new Map([
    ['app.ts', 'app types\n'],
    ['party.ts', 'party types\n'],
  ]);

  it('finds nothing when the folder matches', () => {
    expect(compareFolder(generated, new Map(generated))).toEqual([]);
  });

  it('names a missing file', () => {
    expect(compareFolder(generated, new Map([['app.ts', 'app types\n']]))).toEqual([
      'party.ts is missing.',
    ]);
  });

  it('names a changed file', () => {
    const folder = new Map([...generated, ['party.ts', 'party types, edited\n']]);
    expect(compareFolder(generated, folder)).toEqual(['party.ts differs from the database.']);
  });

  it('names the file for a schema the database has gained', () => {
    const withGrants = new Map([...generated, ['grants.ts', 'grants types\n']]);
    expect(compareFolder(withGrants, generated)).toEqual(['grants.ts is missing.']);
  });

  it('names a file whose schema the database does not have', () => {
    const folder = new Map([...generated, ['grants.ts', 'grants types\n']]);
    expect(compareFolder(generated, folder)).toEqual(['grants.ts has no schema in the database.']);
  });
});

describe('writeFolder and readFolder', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tps-db-types-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a missing folder as empty', async () => {
    await expect(readFolder(join(root, 'missing'))).resolves.toEqual(new Map());
  });

  it('leaves the folder holding exactly the generated files', async () => {
    const folder = join(root, 'generated');
    const generated = new Map([['app.ts', 'app types\n']]);
    await writeFolder(folder, new Map([['grants.ts', 'grants types\n']]));
    await writeFile(join(folder, 'README.md'), 'Not a types file.');

    await writeFolder(folder, generated);

    expect(await readFolder(folder)).toEqual(generated);
    expect((await readdir(folder)).sort()).toEqual(['README.md', 'app.ts']);
  });
});
