// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Answers classified from the form version each application pinned (S11-78),
// read as app_api in a tenant's transaction: each application resolves from
// its own version, never another tenant's, and an unreadable version is
// refused. Also checks each per-field entry of the classification map against
// the catalogue.

import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { classification, type ClassificationRegistry } from '../../classification.ts';
import { classifyAnswers, pinnedDefinitions } from '../../src/classification-answers.ts';
import { createDatabase } from '../../src/database.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { databaseSettings, withClient } from '../connect.ts';
import { addOrganisation } from '../party/fixtures.ts';
import { asMigratorIn, createTestTenant, insertRow, type TestTenant } from '../tenants.ts';
import { addParts, applicationRow } from './application-fixtures.ts';

/** Version 1 (the fixture's) leaves f_name unclassified, so personal; version 2 makes it public. */
const PUBLIC_NAME = {
  sections: [
    {
      id: 's_about',
      title: 'About your project',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Project name', classification: 'public' },
      ],
    },
  ],
};
const UNPARSEABLE = { sections: 'synthetic-unparseable' };

interface Applications {
  readonly tenant: TestTenant;
  /** Pinned to version 1, the older one. */
  readonly older: string;
  /** Pinned to version 2. */
  readonly newer: string;
  /** Pinned to version 3, published with a definition the engine refuses. */
  readonly broken: string;
}

async function addApplications(): Promise<Applications> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const parts = await addParts(client, tenant);
    const publish = (version: number, definition: object) =>
      insertRow(client, 'grants.form_version', {
        tenant_id: tenant.id,
        round_id: parts.round,
        version,
        status: 'published',
        definition,
        published_at: new Date(),
        published_by: parts.member,
      });
    const apply = async (formVersion: string) =>
      insertRow(
        client,
        'grants.application',
        applicationRow(tenant, parts, {
          form_version_id: formVersion,
          organisation_id: await addOrganisation(client, tenant),
        }),
      );
    const newer = await publish(2, PUBLIC_NAME);
    const broken = await publish(3, UNPARSEABLE);
    return {
      tenant,
      older: await apply(parts.formVersion),
      newer: await apply(newer),
      broken: await apply(broken),
    };
  });
}

let db: Kysely<unknown>;
let a: Applications;
let b: Applications;
beforeAll(async () => {
  db = createDatabase(databaseSettings('app_api', 1));
  a = await addApplications();
  b = await addApplications();
});
afterAll(async () => {
  await db.destroy();
});

const inA = (ids: readonly string[]) =>
  withTenant(db, trustedTenantId(a.tenant.id), (trx) => pinnedDefinitions(trx, ids));

describe('pinnedDefinitions', () => {
  it('resolves each answer from the version its application pinned, not the latest', async () => {
    const definitions = await inA([a.older, a.newer]);
    const classOf = (id: string) => {
      const definition = definitions.get(id);
      if (!definition) throw new Error('No definition was loaded.');
      return classifyAnswers(definition, { f_name: 'Synthetic project' })['f_name']?.classification;
    };
    expect(classOf(a.older)).toBe('personal');
    expect(classOf(a.newer)).toBe('public');
  });

  it('refuses a definition that does not parse, naming no value', async () => {
    const refusal = inA([a.broken]);
    await expect(refusal).rejects.toThrow(
      /^An application has no pinned form version that can be read\.$/,
    );
    await expect(refusal).rejects.not.toThrow(/synthetic-unparseable/);
  });

  it('returns nothing for another tenant’s applications and never reads their versions', async () => {
    // b.broken would throw if its version were read from A's context.
    expect(await inA([b.older, b.newer, b.broken])).toEqual(new Map());
    expect([...(await inA([a.older, b.newer])).keys()]).toEqual([a.older]);
  });

  it('returns nothing with no tenant set', async () => {
    const definitions = await db
      .transaction()
      .execute((trx) => pinnedDefinitions(trx, [a.older, a.newer]));
    expect(definitions).toEqual(new Map());
  });
});

/** Each per-field entry's version column and definition source exist, and its ceiling is special category. */
async function perFieldProblems(registry: ClassificationRegistry): Promise<string[]> {
  const { rows } = await withClient('app_api', (client) =>
    client.query<{ name: string }>(
      `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS name
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
          AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'`,
    ),
  );
  const columns = new Set(rows.map(({ name }) => name));
  return Object.entries(registry).flatMap(([table, fields]) =>
    Object.entries(fields).flatMap(([column, { sensitivity, perField }]) => {
      if (!perField) return [];
      const source = `${perField.definition.table}.${perField.definition.column}`;
      return [
        ...(columns.has(`${table}.${perField.versionColumn}`)
          ? []
          : [
              `${table}.${column} pins its version in ${perField.versionColumn}, which does not exist.`,
            ]),
        ...(columns.has(source)
          ? []
          : [`${table}.${column} reads ${source}, which does not exist.`]),
        ...(sensitivity === 'special_category'
          ? []
          : [
              `${table}.${column} is classified per field, so its ceiling must be special_category.`,
            ]),
      ];
    }),
  );
}

describe('per-field classification', () => {
  it('passes the shipped map', async () => {
    expect(await perFieldProblems(classification)).toEqual([]);
  });

  it('names the table of an entry whose version column or definition source does not exist', async () => {
    const answers = classification['grants.application']?.['answers'];
    if (!answers?.perField) throw new Error('grants.application.answers is not per field.');
    const registry: ClassificationRegistry = {
      'grants.application': {
        answers: {
          ...answers,
          sensitivity: 'personal',
          perField: {
            versionColumn: 'pinned_version',
            definition: { table: 'grants.form_version', column: 'body' },
          },
        },
      },
    };
    expect(await perFieldProblems(registry)).toEqual([
      'grants.application.answers pins its version in pinned_version, which does not exist.',
      'grants.application.answers reads grants.form_version.body, which does not exist.',
      'grants.application.answers is classified per field, so its ceiling must be special_category.',
    ]);
  });
});
