// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  classification,
  fileProcessing,
  mergeSchemaMaps,
  processing,
  subjectPaths,
  type ClassificationRegistry,
  type FieldClassification,
  type ProcessingEntry,
  type ProcessingMap,
  type ProcessingRegistry,
} from '../classification.ts';
import {
  processingProblems,
  recordsByPurpose,
  recordsOfProcessing,
} from './records-of-processing.ts';

const field = (sensitivity: FieldClassification['sensitivity']): FieldClassification => ({
  sensitivity,
  retention: { kind: 'tenant_lifetime' },
});

const entry: ProcessingEntry = {
  purpose: 'assessment',
  legalBasis: 'contract',
  processors: ['hosting'],
  dataSubjects: [],
  dataCategories: [],
};
const aboutPeople: ProcessingEntry = {
  ...entry,
  dataSubjects: ['applicant'],
  dataCategories: ['identity'],
};

// The type checker holds a table to its entry; this block fails to compile if not.
const typed = { 't.a': { id: field('internal') } } satisfies ClassificationRegistry;
// @ts-expect-error every table of the registry needs an entry
const missing: ProcessingRegistry<typeof typed> = {};
// @ts-expect-error a file typed plainly as a registry names no tables
const wide: ProcessingRegistry<ClassificationRegistry> = { 't.a': entry };

describe('the shipped map', () => {
  it('has no processing problems', () => {
    expect(processingProblems()).toEqual([]);
  });

  it('gives every table its own entry, and no entry without a table', () => {
    expect(Object.keys(processing).sort()).toEqual(Object.keys(classification).sort());
  });

  it('gives the type checks in this file something to hold', () => {
    expect([typed, missing, wide]).toHaveLength(3);
  });

  it('reports answers as per field with a special category ceiling and a condition', () => {
    const application = recordsOfProcessing().find(({ table }) => table === 'grants.application');
    expect(application?.highestSensitivity).toBe('special_category');
    expect(application?.article9Condition).toBe('explicit_consent');
    expect(application?.columns.find(({ column }) => column === 'answers')?.perField).toBe(true);
  });

  it.each([
    'grants.decision',
    'grants.decision_email',
    'party.organisation',
    'party.person',
    'auth.passkey',
  ])('records that %s reaches the email processor through an email body', (table) => {
    const row = recordsOfProcessing().find((record) => record.table === table);
    expect(row?.processors).toContain('email');
  });

  it('matches the committed register', () => {
    expect(recordsOfProcessing()).toMatchSnapshot();
  });
});

describe('processingProblems', () => {
  it('names a table with no processing entry', () => {
    expect(processingProblems({ 't.a': { id: field('internal') } }, {}, {})).toEqual([
      't.a has no processing entry.',
    ]);
  });

  it('names a table with a processing entry but no columns', () => {
    expect(processingProblems({ 't.a': {} }, { 't.a': entry }, {})).toEqual([
      't.a has a processing entry but no columns.',
    ]);
    expect(processingProblems({}, { 't.a': entry }, {})).toEqual([
      't.a has a processing entry but no columns.',
    ]);
  });

  it.each([
    ['purpose', { purpose: 'marketing' }, 'marketing is not a purpose code.'],
    ['legal basis', { legalBasis: 'because' }, 'because is not a legal basis code.'],
    ['processor role', { processors: ['AcmeCloud'] }, 'AcmeCloud is not a processor role code.'],
    ['data subject', { dataSubjects: ['pet'] }, 'pet is not a data subject code.'],
    ['data category', { dataCategories: ['bank'] }, 'bank is not a data category code.'],
  ])('names a table whose %s is not in its closed list', (_name, change, problem) => {
    const entries = { 't.a': { ...aboutPeople, ...change } } as unknown as ProcessingMap;
    expect(processingProblems({ 't.a': { id: field('personal') } }, entries, {})).toContain(
      `t.a: ${problem}`,
    );
  });

  it('names a table with a special category column and no condition', () => {
    expect(
      processingProblems({ 't.a': { x: field('special_category') } }, { 't.a': aboutPeople }, {}),
    ).toEqual(['t.a has a special category column but no Article 9 condition.']);
  });

  it('names a condition on a table with no special category column', () => {
    expect(
      processingProblems(
        { 't.a': { id: field('internal') } },
        { 't.a': { ...entry, article9Condition: 'explicit_consent' } },
        {},
      ),
    ).toEqual(['t.a has an Article 9 condition but no special category column.']);
  });

  it('treats a per-field ceiling as a special category column', () => {
    const answers = {
      ...field('special_category'),
      perField: { versionColumn: 'v', definition: { table: 't.b', column: 'c' } },
    };
    expect(processingProblems({ 't.a': { answers } }, { 't.a': aboutPeople }, {})).toEqual([
      't.a has a special category column but no Article 9 condition.',
    ]);
  });

  it('names a table with personal columns that lists no subject or category', () => {
    expect(processingProblems({ 't.a': { x: field('personal') } }, { 't.a': entry }, {})).toEqual([
      't.a lists no data subject.',
      't.a lists no data category.',
    ]);
  });

  it('names a table with no personal data and no path that states categories', () => {
    expect(
      processingProblems({ 't.a': { id: field('internal') } }, { 't.a': aboutPeople }, {}),
    ).toEqual(['t.a has no personal data and no path to a party, so must state none.']);
  });

  it('lets a table with internal columns state who it is about through its path', () => {
    expect(
      processingProblems(
        { 't.a': { party_id: field('internal') } },
        { 't.a': aboutPeople },
        { 't.a': { kind: 'party', column: 'party_id' } },
      ),
    ).toEqual([]);
  });
});

describe('the merge', () => {
  it('refuses a processing entry for a table outside its schema', () => {
    expect(() => mergeSchemaMaps({ app: { 'grants.stray': entry } })).toThrow(
      'classification/app.ts names grants.stray, outside its schema.',
    );
  });

  it("reads a file's own entries by name, and none from a file with no tables yet", () => {
    const entries = { 'crm.contact': entry };
    expect(fileProcessing('crm', { crm: {}, crmProcessing: entries })).toBe(entries);
    expect(fileProcessing('crm', { crm: {} })).toEqual({});
  });
});

describe('recordsOfProcessing', () => {
  it('throws, naming the table, rather than build a register from a broken map', () => {
    expect(() => recordsOfProcessing({ 't.a': { id: field('internal') } }, {}, {})).toThrow(
      't.a has no processing entry.',
    );
  });

  it('orders tables and columns, and reports each rule and the highest sensitivity', () => {
    const registry: ClassificationRegistry = {
      'z.b': { id: field('internal') },
      'a.a': {
        name: { sensitivity: 'personal', retention: { kind: 'fixed', days: 30, from: 'at' } },
        at: {
          sensitivity: 'internal',
          retention: { kind: 'tenant_policy', policy: 'p', minimumDays: 365 },
        },
      },
    };
    const register = recordsOfProcessing(
      registry,
      { 'z.b': entry, 'a.a': aboutPeople },
      { 'a.a': { kind: 'party', column: 'name' } },
    );
    expect(register.map(({ table }) => table)).toEqual(['a.a', 'z.b']);
    expect(register[0]).toMatchObject({
      highestSensitivity: 'personal',
      article9Condition: null,
      subjectPath: { kind: 'party', column: 'name' },
      columns: [
        {
          column: 'at',
          sensitivity: 'internal',
          retention: { kind: 'tenant_policy', policy: 'p', minimumDays: 365 },
          perField: false,
        },
        {
          column: 'name',
          sensitivity: 'personal',
          retention: { kind: 'fixed', days: 30, from: 'at' },
          perField: false,
        },
      ],
    });
    expect(register[1]?.subjectPath).toBeNull();
  });
});

describe('recordsByPurpose', () => {
  it('groups the register by purpose in purpose order, with merged, sorted codes', () => {
    const register = recordsOfProcessing(
      { 'a.a': { id: field('personal') }, 'a.b': { id: field('internal') } },
      {
        'a.a': { ...aboutPeople, purpose: 'decisions', processors: ['email', 'hosting'] },
        'a.b': { ...entry, purpose: 'account_security', processors: ['hosting', 'backup'] },
      },
      subjectPaths,
    );
    const grouped = recordsByPurpose(register);
    expect(grouped.map(({ purpose }) => purpose)).toEqual(['account_security', 'decisions']);
    expect(grouped[1]).toMatchObject({
      legalBases: ['contract'],
      article9Conditions: [],
      processors: ['email', 'hosting'],
      dataSubjects: ['applicant'],
      dataCategories: ['identity'],
      highestSensitivity: 'personal',
    });
    expect(grouped[1]?.tables.map(({ table }) => table)).toEqual(['a.a']);
  });

  it('builds from the shipped map by default', () => {
    expect(recordsByPurpose().flatMap(({ tables }) => tables)).toHaveLength(
      recordsOfProcessing().length,
    );
  });
});
