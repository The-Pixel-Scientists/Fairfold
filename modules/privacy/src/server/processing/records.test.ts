// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The generated record of processing: one entry for every table in the
// shipped classification map, each passing the contract's schema, and a
// snapshot of each table's codes. Adding a table to a classification file
// changes the snapshot and nothing in this folder.

import { classification } from '@pixel-scientists/db/classification';
import { describe, expect, it } from 'vitest';

import { processingRecordEntrySchema, processingRecordSchema } from '../../contracts/index.ts';
import { processingRecordEntries } from './records.ts';

const entries = processingRecordEntries();

describe('the generated record of processing', () => {
  it('has one entry for every classified table, each valid under the contract', () => {
    expect(entries.map(({ table }) => table).sort()).toEqual(Object.keys(classification).sort());
    for (const entry of entries) {
      expect(processingRecordEntrySchema.safeParse(entry).success, entry.table).toBe(true);
    }
    expect(
      processingRecordSchema.safeParse({ generatedAt: new Date().toISOString(), tables: entries })
        .success,
    ).toBe(true);
  });

  it('marks each table with its owning module, and gives the job schema to the platform', () => {
    const module = (table: string) => entries.find((entry) => entry.table === table)?.module;
    expect(module('privacy.rights_request')).toBe('privacy');
    expect(module('party.person')).toBe('party');
    expect(module('grants.application')).toBe('grants');
    expect(module('app.audit_event')).toBe('platform');
    expect(module('pgboss.job')).toBe('platform');
  });

  it('keeps a table longest by its longest-kept column, and names the path to a person', () => {
    const entry = (table: string) => entries.find((candidate) => candidate.table === table);
    expect(entry('privacy.request_task')?.subjectPaths).toEqual([
      'privacy.request_task.request_id',
    ]);
    expect(entry('privacy.rights_request')?.subjectPaths).toEqual([
      'privacy.rights_request.subject_person_id',
    ]);
    expect(entry('privacy.rights_request')?.sensitivity).toBe('special_category');
  });

  it('matches the snapshot of the shipped map', () => {
    const lines = entries.map(
      (entry) =>
        `${entry.table} | ${entry.module} | ${entry.purpose} | ${entry.legalBasis} | ` +
        `${entry.sensitivity} | ${entry.retention.rule} ${entry.retention.days ?? '-'} | ` +
        `${entry.dataCategories.join(',') || '-'} | ${entry.subjectPaths.join(',') || '-'}`,
    );
    expect(lines.join('\n')).toMatchSnapshot();
  });
});
