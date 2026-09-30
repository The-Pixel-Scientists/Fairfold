// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqlFolderMigrationProvider } from './migrations.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixelgrant-migrations-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function addMigration(name: string, files: Record<string, string>): Promise<void> {
  await mkdir(join(root, name));
  for (const [file, text] of Object.entries(files)) {
    await writeFile(join(root, name, file), text);
  }
}

describe('SqlFolderMigrationProvider', () => {
  it('treats a missing migrations folder as no migrations', async () => {
    const provider = new SqlFolderMigrationProvider(join(root, 'missing'));
    await expect(provider.getMigrations()).resolves.toEqual({});
  });

  it('returns one migration per folder, with up and down', async () => {
    await addMigration('0001_app_schema', { 'up.sql': 'SELECT 1;', 'down.sql': 'SELECT 2;' });
    await addMigration('0002_tenant', { 'up.sql': 'SELECT 3;', 'down.sql': 'SELECT 4;' });
    await writeFile(join(root, 'README.md'), 'Notes are ignored.');

    const migrations = await new SqlFolderMigrationProvider(root).getMigrations();

    expect(Object.keys(migrations).sort()).toEqual(['0001_app_schema', '0002_tenant']);
    expect(Object.keys(migrations['0001_app_schema'] ?? {}).sort()).toEqual(['down', 'up']);
  });

  it('refuses a folder without down.sql', async () => {
    await addMigration('0001_app_schema', { 'up.sql': 'SELECT 1;' });
    await expect(new SqlFolderMigrationProvider(root).getMigrations()).rejects.toThrow(
      'needs both up.sql and down.sql; down.sql is missing',
    );
  });

  it('refuses an empty SQL file', async () => {
    await addMigration('0001_app_schema', { 'up.sql': 'SELECT 1;', 'down.sql': '  \n' });
    await expect(new SqlFolderMigrationProvider(root).getMigrations()).rejects.toThrow('is empty');
  });

  it('refuses a folder that is not named NNNN_description', async () => {
    for (const name of ['1_app', '0001-app', '0001_App', '0001_']) {
      await rm(root, { recursive: true, force: true });
      await mkdir(root);
      await addMigration(name, { 'up.sql': 'SELECT 1;', 'down.sql': 'SELECT 2;' });
      await expect(new SqlFolderMigrationProvider(root).getMigrations()).rejects.toThrow(
        'must be named NNNN_description',
      );
    }
  });

  it('refuses two migrations with the same number', async () => {
    await addMigration('0001_app_schema', { 'up.sql': 'SELECT 1;', 'down.sql': 'SELECT 2;' });
    await addMigration('0001_tenant', { 'up.sql': 'SELECT 3;', 'down.sql': 'SELECT 4;' });
    await expect(new SqlFolderMigrationProvider(root).getMigrations()).rejects.toThrow(
      'share the number 0001',
    );
  });
});
