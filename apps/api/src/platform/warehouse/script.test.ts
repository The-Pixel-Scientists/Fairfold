// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { classification } from '@pixel-scientists/db/classification';
import {
  warehouseModelVersion,
  type ClassificationLookup,
} from '@pixel-scientists/domain/warehouse';
import { describe, expect, it } from 'vitest';

import { SnapshotTooLarge, writeScript, type TableRows } from './script.ts';

const tenantId = randomUUID();
const at = new Date('2026-10-23T09:30:00.000Z');
const MAX = 1024 * 1024;

const organisation = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  status: 'active',
  name: 'Northfield Allotment Society',
  legal_form: 'charity',
  website: 'https://example.org',
  org_id: 'GB-CHC-1234567',
  org_id_verified: true,
  created_at: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const script = (
  tables: readonly TableRows[],
  options: { classification?: ClassificationLookup; maxBytes?: number } = {},
) =>
  writeScript({
    tenantId,
    at,
    tables,
    classification: options.classification ?? classification,
    maxBytes: options.maxBytes ?? MAX,
  });

/** The real map with one column reclassified. */
function reclassified(source: string, sensitivity: string): ClassificationLookup {
  const dot = source.lastIndexOf('.');
  const table = source.slice(0, dot);
  const name = source.slice(dot + 1);
  return {
    ...classification,
    [table]: { ...classification[table], [name]: { sensitivity } },
  };
}

describe('writeScript', () => {
  it('writes the header, one transaction, each table and its rows, and counts the rows', () => {
    const first = organisation();
    const second = organisation({ website: null, org_id: null, org_id_verified: null });

    const { script: text, counts } = script([{ name: 'organisation', rows: [first, second] }]);

    expect(counts).toEqual({ organisation: 2 });
    expect(text.split('\n')).toEqual([
      '-- Warehouse snapshot',
      `-- Tenant: ${tenantId}`,
      '-- Created: 2026-10-23T09:30:00.000Z',
      `-- Model version: ${warehouseModelVersion}`,
      '',
      "SET client_encoding = 'UTF8';",
      'BEGIN;',
      '',
      'CREATE TABLE "organisation" (',
      '  "id" uuid NOT NULL,',
      '  "status" text NOT NULL,',
      '  "name" text NOT NULL,',
      '  "legal_form" text NOT NULL,',
      '  "website" text,',
      '  "org_id" text,',
      '  "org_id_verified" boolean,',
      '  "created_at" timestamptz NOT NULL,',
      '  PRIMARY KEY ("id")',
      ');',
      '',
      'COPY "organisation" ("id", "status", "name", "legal_form", "website", "org_id", "org_id_verified", "created_at") FROM stdin;',
      [
        first.id,
        'active',
        'Northfield Allotment Society',
        'charity',
        'https://example.org',
        'GB-CHC-1234567',
        't',
        '2026-10-01T10:00:00.000Z',
      ].join('\t'),
      [
        second.id,
        'active',
        'Northfield Allotment Society',
        'charity',
        '\\N',
        '\\N',
        '\\N',
        '2026-10-01T10:00:00.000Z',
      ].join('\t'),
      '\\.',
      '',
      'COMMIT;',
      '',
    ]);
  });

  it('fills source_module with the feeding module, and writes an empty table as an empty block', () => {
    const { script: text } = script([{ name: 'programme', rows: [] }]);
    expect(text).toContain('  "source_module" text NOT NULL,');
    expect(text).toContain('FROM stdin;\n\\.\n');

    const row = {
      id: randomUUID(),
      title: 'Community grants',
      summary: 'Small grants',
      status: 'open',
      created_at: '2026-10-01T10:00:00.000Z',
    };
    const { script: filled } = script([{ name: 'programme', rows: [row] }]);
    expect(filled).toContain(`${row.id}\tgrants\tCommunity grants\t`);
  });

  it('drops a column whose source is classified personal, from the table and from every row', () => {
    const website = 'https://hidden.example.org';
    const rows = [organisation({ website })];
    expect(script([{ name: 'organisation', rows }]).script).toContain(website);

    const { script: text } = script([{ name: 'organisation', rows }], {
      classification: reclassified('party.organisation.website', 'personal'),
    });

    expect(text).not.toContain('website');
    expect(text).not.toContain(website);
    expect(text).toContain('"name" text NOT NULL');
  });

  it('drops a column that has any source classified special category, and a derived one with it', () => {
    const { script: text } = script([{ name: 'organisation', rows: [organisation()] }], {
      classification: reclassified('party.organisation_identifier.verified_at', 'special_category'),
    });
    expect(text).not.toContain('org_id_verified');
    expect(text).toContain('"org_id" text');
    expect(text).not.toContain('\tt\t');
  });

  it('never writes a value the model has no column for', () => {
    const { script: text } = script([
      {
        name: 'person',
        rows: [
          {
            id: randomUUID(),
            status: 'active',
            created_at: '2026-10-01T10:00:00.000Z',
            email: 'jo@example.org',
            given_name: 'Jo',
          },
        ],
      },
    ]);
    expect(text).not.toContain('jo@example.org');
    expect(text).not.toContain('given_name');
  });

  it('refuses a table whose key would be left out', () => {
    expect(() =>
      script([{ name: 'person', rows: [] }], {
        classification: reclassified('party.person.id', 'personal'),
      }),
    ).toThrow(/key person\.id/);
  });

  it('writes hostile text so that only the table ends a block', () => {
    const hostile = [
      '\\.',
      '\\N',
      'a\tb',
      'line one\nline two',
      'a\\b',
      '\r\n',
      "'; DROP TABLE person; --",
      '\n\\.\nDROP TABLE person;\n',
    ];
    const rows = hostile.map((name) => organisation({ name }));

    const { script: text } = script([{ name: 'organisation', rows }]);

    const lines = text.split('\n');
    expect(lines.filter((line) => line === '\\.')).toHaveLength(1);
    const copy = lines.findIndex((line) => line.startsWith('COPY'));
    expect(lines.slice(copy + 1, copy + 1 + rows.length)).toHaveLength(rows.length);
    for (const line of lines.slice(copy + 1, copy + 1 + rows.length)) {
      expect(line.split('\t')).toHaveLength(8);
    }
    expect(lines.slice(copy + 1 + rows.length)).toEqual(['\\.', '', 'COMMIT;', '']);
  });

  it('refuses a missing value, a null in a column that is not null, and a value of another kind', () => {
    const missing = Object.fromEntries(
      Object.entries(organisation()).filter(([column]) => column !== 'website'),
    );
    expect(() => script([{ name: 'organisation', rows: [missing] }])).toThrow(
      /no value for website/,
    );
    expect(() => script([{ name: 'organisation', rows: [organisation({ name: null })] }])).toThrow(
      /organisation\.name must not be null/,
    );
    expect(() =>
      script([{ name: 'organisation', rows: [organisation({ name: { text: 'x' } })] }]),
    ).toThrow(/no value for name/);
  });

  it('refuses a tenant id that is not an id, so the header cannot carry SQL', () => {
    expect(() =>
      writeScript({
        tenantId: 'x\nDROP TABLE person;',
        at,
        tables: [],
        classification,
        maxBytes: MAX,
      }),
    ).toThrow();
  });

  it('stops as soon as the script passes its limit', () => {
    const rows = Array.from({ length: 100 }, () => organisation());
    const small = script([{ name: 'organisation', rows }]).script.length;

    expect(() => script([{ name: 'organisation', rows }], { maxBytes: small - 1 })).toThrow(
      SnapshotTooLarge,
    );
    expect(() => script([{ name: 'organisation', rows }], { maxBytes: small })).not.toThrow();
  });
});
