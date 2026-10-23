// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse script loaded with psql into a fresh PostgreSQL 16
// container (ADR 0016): hostile values come back exactly as they went in,
// and none of them runs as SQL. The rows are made up here, so every kind of
// hostile text can be tried, including those the application's own checks
// would not store. Docker must be running.

import { randomUUID } from 'node:crypto';

import { classification } from '@pixel-scientists/db/classification';
import type { WarehouseTenant } from '@pixel-scientists/domain/warehouse';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TenantTransaction } from '../../database.ts';
import { startFreshPostgres, type FreshPostgres } from '../../../test/psql.ts';
import { buildSnapshot, type Contribution } from './snapshot.ts';

// The container takes a few seconds to start on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

let postgres: FreshPostgres;

beforeAll(async () => {
  postgres = await startFreshPostgres();
}, 120_000);

afterAll(async () => {
  await postgres.stop();
});

const tenant: WarehouseTenant = { timezone: 'Europe/London', fiscalYearStartMonth: 4 };

const HOSTILE = [
  '\\.',
  '\\N',
  'before\n\\.\nafter',
  '\n\\.\nDROP TABLE person;\n',
  'tab\there\tand\tthere',
  'new\nline\r\nand carriage\rreturn',
  'back\\slash \\\\ \\t \\n \\x41',
  "'; DROP TABLE person; --",
  '"; DROP TABLE person; --',
  "O'Neil & Sons; DELETE FROM organisation; \\. COMMIT; --",
  '$$ DROP TABLE person; $$',
  '   leading and trailing   ',
  '',
  'Zoë 東京 🌸',
];

const at = '2026-10-01T10:00:00.000Z';

const organisations = HOSTILE.map((name, index) => ({
  id: randomUUID(),
  status: 'active',
  name,
  legal_form: 'charity',
  website: index % 2 === 0 ? name : null,
  org_id: index % 3 === 0 ? 'GB-CHC-1234567' : null,
  org_id_verified: index % 3 === 0 ? index % 2 === 0 : null,
  created_at: at,
}));

const people = [randomUUID(), randomUUID()].map((id) => ({
  id,
  status: 'active',
  created_at: at,
}));

const programmes = HOSTILE.slice(0, 5).map((title) => ({
  id: randomUUID(),
  title,
  summary: title,
  status: 'open',
  created_at: at,
}));

const commitments = [
  {
    id: randomUUID(),
    programme_id: programmes[0]?.id ?? '',
    organisation_id: organisations[0]?.id ?? '',
    amount_minor: 1_500_000,
    currency: 'GBP',
    committed_on: '2026-03-30',
  },
  {
    id: randomUUID(),
    programme_id: programmes[1]?.id ?? '',
    organisation_id: organisations[1]?.id ?? '',
    amount_minor: 100_000_000_000,
    currency: 'GBP',
    committed_on: '2026-04-02',
  },
];

const fed = (rows: Record<string, readonly Record<string, unknown>[]>) =>
  Object.fromEntries(
    Object.entries(rows).map(([name, list]) => [name, () => Promise.resolve(list)]),
  );

const contributions: Contribution[] = [
  { module: 'party', tables: fed({ organisation: organisations, person: people }) },
  {
    module: 'grants',
    tables: fed({
      programme: programmes,
      commitment: commitments,
      grants_round: [],
      grants_application: [],
      grants_score: [],
    }),
  },
];

async function snapshot() {
  const { script } = await buildSnapshot({} as TenantTransaction, {
    tenantId: randomUUID(),
    tenant,
    contributions,
    classification,
    at: new Date('2026-10-23T09:30:00.000Z'),
    maxBytes: 5 * 1024 * 1024,
  });
  return script;
}

describe('a snapshot loaded with psql', () => {
  it('loads without an error, and every table has the rows it was given', async () => {
    const loaded = await postgres.load(await snapshot());

    expect(loaded.stderr).toBe('');
    expect(loaded.code).toBe(0);
    const counts = await postgres.json<Record<string, number>>(
      loaded.database,
      `SELECT json_build_object(
         'organisation', (SELECT count(*) FROM organisation),
         'person', (SELECT count(*) FROM person),
         'programme', (SELECT count(*) FROM programme),
         'commitment', (SELECT count(*) FROM commitment),
         'date', (SELECT count(*) FROM date),
         'grants_round', (SELECT count(*) FROM grants_round))`,
    );
    expect(counts).toEqual({
      organisation: organisations.length,
      person: 2,
      programme: programmes.length,
      commitment: 2,
      date: 4,
      grants_round: 0,
    });
  });

  it('returns hostile text exactly as it went in, and keeps null apart from the text \\N', async () => {
    const { database } = await postgres.load(await snapshot());

    const found = await postgres.json<(typeof organisations)[number][]>(
      database,
      `SELECT coalesce(json_agg(o), '[]') FROM (
         SELECT id, status, name, legal_form, website, org_id, org_id_verified,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
           FROM organisation) o`,
    );

    const key = (row: { id: string }) => row.id;
    expect([...found].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      [...organisations].sort((a, b) => key(a).localeCompare(key(b))),
    );
    const names = found.map((row) => row.name);
    for (const value of HOSTILE) expect(names).toContain(value);
    expect(found.filter((row) => row.website === null)).toHaveLength(
      organisations.filter((row) => row.website === null).length,
    );
  });

  it.each(['WIN1252', 'LATIN1', 'SJIS'])(
    "loads the same values whatever the loader's client encoding (%s)",
    async (clientEncoding) => {
      const loaded = await postgres.load(await snapshot(), { clientEncoding });

      expect(loaded.stderr).toBe('');
      expect(loaded.code).toBe(0);
      const names = await postgres.json<string[]>(
        loaded.database,
        'SELECT json_agg(name) FROM organisation',
      );
      expect([...names].sort()).toEqual([...HOSTILE].sort());
      const titles = await postgres.json<string[]>(
        loaded.database,
        'SELECT json_agg(title) FROM programme',
      );
      expect([...titles].sort()).toEqual([...HOSTILE.slice(0, 5)].sort());
    },
  );

  it('never runs a value as SQL: nothing the values name is dropped or deleted', async () => {
    const { database } = await postgres.load(await snapshot());

    const tables = await postgres.json<string[]>(
      database,
      `SELECT json_agg(table_name ORDER BY table_name) FROM information_schema.tables
        WHERE table_schema = 'public'`,
    );

    expect(tables).toEqual([
      'commitment',
      'date',
      'grants_application',
      'grants_round',
      'grants_score',
      'organisation',
      'person',
      'programme',
    ]);
    expect(await postgres.json<number>(database, 'SELECT count(*) FROM person')).toBe(2);
  });

  it('fills source_module and joins commitments to organisations and dates', async () => {
    const { database } = await postgres.load(await snapshot());

    const joined = await postgres.json<Record<string, unknown>[]>(
      database,
      `SELECT json_agg(j ORDER BY j.committed_on) FROM (
         SELECT c.committed_on, c.amount_minor, c.source_module, o.name AS organisation,
                p.title AS programme, d.fiscal_year, d.fiscal_quarter
           FROM commitment c
           JOIN organisation o ON o.id = c.organisation_id
           JOIN programme p ON p.id = c.programme_id
           JOIN date d ON d.date = c.committed_on) j`,
    );

    expect(joined).toEqual([
      {
        committed_on: '2026-03-30',
        amount_minor: 1_500_000,
        source_module: 'grants',
        organisation: HOSTILE[0],
        programme: HOSTILE[0],
        fiscal_year: 2025,
        fiscal_quarter: 4,
      },
      {
        committed_on: '2026-04-02',
        amount_minor: 100_000_000_000,
        source_module: 'grants',
        organisation: HOSTILE[1],
        programme: HOSTILE[1],
        fiscal_year: 2026,
        fiscal_quarter: 1,
      },
    ]);
  });

  it('rolls back whole when a row is refused, leaving no table behind', async () => {
    const script = (await snapshot()).replace(
      organisations[0]?.id ?? '',
      organisations[1]?.id ?? '',
    );

    const loaded = await postgres.load(script);

    expect(loaded.code).not.toBe(0);
    const tables = await postgres.json<number>(
      loaded.database,
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables).toBe(0);
  });
});
