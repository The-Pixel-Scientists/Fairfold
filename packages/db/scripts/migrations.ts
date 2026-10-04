// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Feeds the hand-written SQL migrations in packages/db/migrations to Kysely's
// Migrator (ADR 0003). Each migration is a folder named
// NNNN_<schema>_<description>, naming the one schema it changes (ADR 0016),
// and holds up.sql and down.sql. The Migrator takes an advisory lock, runs a
// batch in one transaction and records history in the `migrations` schema.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompiledQuery, type Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** The schemas a migration may change: the platform's, then each module's (ADR 0016). */
export const SCHEMAS = ['app', 'auth', 'party', 'grants'] as const;

const MIGRATION_NAME = /^(\d{4})_([a-z0-9]+)_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Run one SQL file as written. Only reviewed migration files reach this. */
function runSqlFile(db: Kysely<unknown>, text: string): Promise<unknown> {
  return db.executeQuery(CompiledQuery.raw(text));
}

export class SqlFolderMigrationProvider implements MigrationProvider {
  readonly #folder: string;

  constructor(folder: string) {
    this.#folder = folder;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    let entries;
    try {
      entries = await readdir(this.#folder, { withFileTypes: true });
    } catch (error) {
      // No migrations folder yet means no migrations.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }

    const migrations: Record<string, Migration> = {};
    const numbers = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const [, number, schema] = MIGRATION_NAME.exec(entry.name) ?? [];
      if (!number || !schema) {
        throw new Error(
          `Migration folder ${entry.name} must be named NNNN_<schema>_<description>, in lower case with underscores.`,
        );
      }
      if (!(SCHEMAS as readonly string[]).includes(schema)) {
        throw new Error(
          `Migration folder ${entry.name} names the unknown schema ${schema}. Use one of ${SCHEMAS.join(', ')}.`,
        );
      }
      const clash = numbers.get(number);
      if (clash) {
        throw new Error(`Migrations ${clash} and ${entry.name} share the number ${number}.`);
      }
      numbers.set(number, entry.name);

      const folder = join(this.#folder, entry.name);
      const up = await readRequired(folder, 'up.sql');
      const down = await readRequired(folder, 'down.sql');
      migrations[entry.name] = {
        up: (db) => runSqlFile(db, up).then(() => undefined),
        down: (db) => runSqlFile(db, down).then(() => undefined),
      };
    }
    return migrations;
  }
}

async function readRequired(folder: string, file: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(join(folder, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Migration ${folder} needs both up.sql and down.sql; ${file} is missing.`, {
        cause: error,
      });
    }
    throw error;
  }
  if (text.trim() === '') throw new Error(`${join(folder, file)} is empty.`);
  return text;
}

export function createMigrator(db: Kysely<unknown>, folder = MIGRATIONS_FOLDER): Migrator {
  return new Migrator({
    db,
    provider: new SqlFolderMigrationProvider(folder),
    migrationTableSchema: 'migrations',
    migrationTableName: 'kysely_migration',
    migrationLockTableName: 'kysely_migration_lock',
  });
}
