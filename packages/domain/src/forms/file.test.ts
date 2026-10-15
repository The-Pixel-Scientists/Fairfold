// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { fileTypes, MAX_FILE_BYTES, MAX_FILES_PER_FIELD } from '../files/types.ts';
import { messageForIssue } from '../platform/messages.ts';
import { projectionAudiences } from './audience.ts';
import type { FileField } from './definition.ts';
import { checkFile } from './file.ts';
import {
  budgetForm,
  documentsAnswers,
  documentsForm,
  documentsInput,
  exampleForm,
  exampleInput,
} from './fixture.ts';
import { formMessages as m } from './messages.ts';
import { projectAnswers } from './project.ts';
import { changedFieldTypes, formDefinitionSchema, parseDefinition } from './rules.ts';
import { validateAnswers } from './validate.ts';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MB = 1024 * 1024;

type Input = typeof documentsInput;

/** A copy of the documents form with one change to the accounts question, made by `change`. */
function variant(change: (accounts: Record<string, unknown>, input: Input) => void): unknown {
  const copy = JSON.parse(JSON.stringify(documentsInput)) as Input;
  change(copy.sections[0]?.fields[0] as Record<string, unknown>, copy);
  return copy;
}

function refusals(input: unknown): { path: string; message: string }[] {
  const result = parseDefinition(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: messageForIssue(issue),
      }));
}

function fileField(id: string, form = documentsForm): FileField {
  const field = form.sections[0]?.fields.find((each) => each.id === id);
  if (field?.type !== 'file') throw new Error(`The form has no file question ${id}.`);
  return field;
}

const accountsAt = 'sections.0.fields.0';
const ids = {
  a: '0f8fad5b-d9cb-469f-a165-70867728950e',
  b: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  c: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
  d: '6fa459ea-ee8a-4ca4-894e-db77e160355e',
};

describe('a file question', () => {
  it('parses with every default written out', () => {
    expect(refusals(documentsInput)).toEqual([]);
    expect(fileField('f_photos')).toEqual({
      id: 'f_photos',
      type: 'file',
      label: 'Photos of the hall',
      required: false,
      identity: true,
      audiences: ['applicant', 'staff', 'reviewer'],
      conditions: [],
      allowedTypes: [...fileTypes],
      maxBytes: MAX_FILE_BYTES,
      maxFiles: 3,
    });
    expect(fileField('f_leasecopy').maxFiles).toBe(1);
    expect(fileField('f_accounts')).toMatchObject({ allowedTypes: [PDF, DOCX], maxBytes: 5 * MB });
  });

  it('refuses types outside the list, none, or one listed twice', () => {
    const types = (allowedTypes: unknown) =>
      refusals(variant((accounts) => Object.assign(accounts, { allowedTypes })));
    expect(types(['image/svg+xml'])).toHaveLength(1);
    expect(types(['text/html', PDF])).toHaveLength(1);
    expect(types([])).toHaveLength(1);
    expect(types('application/pdf')).not.toEqual([]);
    expect(types([PDF, DOCX, PDF])).toEqual([
      { path: `${accountsAt}.allowedTypes`, message: m.fileTypesUnique },
    ]);
    expect(types([...fileTypes])).toEqual([]);
  });

  it('refuses limits out of range', () => {
    const limits = (change: object) =>
      refusals(variant((accounts) => Object.assign(accounts, change)));
    for (const maxBytes of [0, 1023, MAX_FILE_BYTES + 1, 1024.5]) {
      expect(limits({ maxBytes }), String(maxBytes)).toHaveLength(1);
    }
    for (const maxFiles of [0, MAX_FILES_PER_FIELD + 1, 1.5]) {
      expect(limits({ maxFiles }), String(maxFiles)).toHaveLength(1);
    }
    expect(limits({ maxBytes: 1024, maxFiles: MAX_FILES_PER_FIELD })).toEqual([]);
    expect(limits({ maxBytes: MAX_FILE_BYTES, maxFiles: 1 })).toEqual([]);
  });

  it('refuses an aggregate-only file question', () => {
    const input = variant((accounts) => Object.assign(accounts, { audiences: 'aggregate_only' }));
    expect(refusals(input)).toEqual([
      { path: `${accountsAt}.audiences`, message: m.fileAudiences },
    ]);
  });

  it('refuses a condition or eligibility rule on a file question, but may be shown by one', () => {
    const condition = variant((_accounts, input) => {
      (input.sections[0]?.fields as object[]).push({
        id: 'f_more',
        type: 'short_text',
        label: 'Tell us more',
        conditions: [{ field: 'f_accounts', equals: 'yes' }],
      });
    });
    expect(refusals(condition)).toEqual([
      { path: 'sections.0.fields.4.conditions.0', message: m.conditionType },
    ]);
    const includes = variant((_accounts, input) => {
      Object.assign(input.sections[0]?.fields[3] as object, {
        conditions: [{ field: 'f_photos', includes: ids.a.slice(0, 8) }],
      });
    });
    expect(refusals(includes)).toEqual([
      { path: 'sections.0.fields.3.conditions.0', message: m.conditionType },
    ]);
    const eligibility = variant((accounts) =>
      Object.assign(accounts, { eligibility: { stopWhen: false, explanation: 'No.' } }),
    );
    expect(parseDefinition(eligibility).success).toBe(false);
  });
});

describe('validateAnswers on file questions', () => {
  it('passes linked file ids in both modes', () => {
    expect(validateAnswers(documentsForm, documentsAnswers, 'draft')).toEqual([]);
    expect(validateAnswers(documentsForm, documentsAnswers, 'submit')).toEqual([]);
  });

  it('on submit, counts an empty list as no answer to a required question', () => {
    const answers = { ...documentsAnswers, f_accounts: [], f_photos: [] };
    expect(validateAnswers(documentsForm, answers, 'draft')).toEqual([]);
    expect(validateAnswers(documentsForm, answers, 'submit')).toEqual([
      { field: 'f_accounts', message: m.uploadFile },
    ]);
    expect(validateAnswers(documentsForm, { f_lease: true }, 'submit')).toEqual([
      { field: 'f_accounts', message: m.uploadFile },
      { field: 'f_leasecopy', message: m.uploadFile },
    ]);
  });

  it('takes only a list of lower-case uuids, and changes none', () => {
    const upper = ids.a.toUpperCase();
    for (const value of [
      ids.a,
      [upper],
      [ids.a, upper],
      ['f8fad5b-d9cb-469f-a165-70867728950e'],
      ['accounts-2025'],
      [{ id: ids.a }],
      [1],
      'none',
      true,
      {},
    ]) {
      const answers = { ...documentsAnswers, f_accounts: value };
      expect(validateAnswers(documentsForm, answers, 'draft'), JSON.stringify(value)).toEqual([
        { field: 'f_accounts', message: m.fileIds },
      ]);
      expect(answers.f_accounts).toBe(value);
    }
  });

  it('refuses a file listed twice and more files than the question takes', () => {
    const check = (f_photos: string[]) =>
      validateAnswers(documentsForm, { ...documentsAnswers, f_photos }, 'draft');
    expect(check([ids.a, ids.b, ids.a])).toEqual([
      { field: 'f_photos', message: m.uploadEachOnce },
    ]);
    expect(check([ids.a, ids.b, ids.c])).toEqual([]);
    expect(check([ids.a, ids.b, ids.c, ids.d])).toEqual([
      { field: 'f_photos', message: m.uploadAtMost(3) },
    ]);
    const accounts = validateAnswers(
      documentsForm,
      { ...documentsAnswers, f_accounts: [ids.a, ids.b] },
      'submit',
    );
    expect(accounts).toEqual([{ field: 'f_accounts', message: 'Upload no more than 1 file.' }]);
  });

  it('refuses files on a question that is not shown, and needs none there', () => {
    expect(
      validateAnswers(documentsForm, { ...documentsAnswers, f_lease: false }, 'draft'),
    ).toEqual([{ field: 'f_leasecopy', message: m.notShown }]);
    const answers = { f_accounts: documentsAnswers.f_accounts, f_lease: false };
    expect(validateAnswers(documentsForm, answers, 'submit')).toEqual([]);
  });
});

describe('checkFile', () => {
  const accounts = fileField('f_accounts');
  const photos = fileField('f_photos');

  it('takes a file of an allowed type up to the limit', () => {
    expect(checkFile(accounts, { bytes: 1, type: PDF })).toBeUndefined();
    expect(checkFile(accounts, { bytes: 5 * MB, type: DOCX })).toBeUndefined();
    expect(checkFile(photos, { bytes: MAX_FILE_BYTES, type: 'image/png' })).toBeUndefined();
  });

  it("refuses a file over the question's limit, giving it in MB", () => {
    expect(checkFile(accounts, { bytes: 5 * MB + 1, type: PDF })).toBe(
      'The file must be 5 MB or smaller.',
    );
    expect(checkFile(photos, { bytes: MAX_FILE_BYTES + 1, type: PDF })).toBe(
      'The file must be 10 MB or smaller.',
    );
  });

  it('refuses a type the question does not take, or one that was not found', () => {
    for (const type of [XLSX, 'image/jpeg', null] as const) {
      expect(checkFile(accounts, { bytes: 100, type }), String(type)).toBe(
        'The file must be a PDF or Word document.',
      );
    }
  });

  it('names the types in words and the limit rounded down', () => {
    const field = (allowedTypes: string[], maxBytes = MAX_FILE_BYTES) =>
      fileField(
        'f_accounts',
        formDefinitionSchema.parse(
          variant((question) => Object.assign(question, { allowedTypes, maxBytes })),
        ),
      );
    expect(checkFile(field([XLSX]), { bytes: 1, type: PDF })).toBe(
      'The file must be an Excel spreadsheet.',
    );
    expect(checkFile(field([PDF, DOCX, 'image/jpeg']), { bytes: 1, type: null })).toBe(
      'The file must be a PDF, Word document or JPEG image.',
    );
    expect(checkFile(photos, { bytes: 1, type: null })).toBe(
      'The file must be a PDF, Word document, Excel spreadsheet, OpenDocument text, ' +
        'OpenDocument spreadsheet, JPEG image or PNG image.',
    );
    for (const [maxBytes, words] of [
      [1024, '1 KB'],
      [200 * 1024, '200 KB'],
      [MB - 1, '1,023.9 KB'],
      [MB, '1 MB'],
      [1.5 * MB, '1.5 MB'],
      [1.5 * MB + 1, '1.5 MB'],
      [2 * MB - 1, '1.9 MB'],
    ] as const) {
      expect(checkFile(field([PDF], maxBytes), { bytes: maxBytes + 1, type: PDF })).toBe(
        `The file must be ${words} or smaller.`,
      );
    }
  });
});

describe('projectAnswers on file questions', () => {
  it('gives each audience the file answers its audiences allow, and blind reviewers none', () => {
    const keys = (audience: (typeof projectionAudiences)[number]) =>
      Object.keys(projectAnswers(documentsForm, documentsAnswers, audience));
    expect(keys('applicant')).toEqual(['f_accounts', 'f_photos', 'f_lease', 'f_leasecopy']);
    expect(keys('staff')).toEqual(['f_accounts', 'f_photos', 'f_lease', 'f_leasecopy']);
    expect(keys('reviewer')).toEqual(['f_accounts', 'f_photos', 'f_lease']);
    expect(keys('blind_reviewer')).toEqual(['f_lease']);
  });

  it('drops a file answer for blind reviewers whatever the identity flag, for every audience set', () => {
    const sets = [['applicant'], ['applicant', 'staff'], ['applicant', 'reviewer'], undefined];
    for (const audiences of sets) {
      for (const identity of [false, true]) {
        const form = formDefinitionSchema.parse(
          variant((accounts) =>
            Object.assign(accounts, { identity }, audiences === undefined ? {} : { audiences }),
          ),
        );
        const sees = audiences ?? ['applicant', 'staff', 'reviewer'];
        for (const audience of projectionAudiences) {
          const projected = projectAnswers(form, documentsAnswers, audience);
          const expected = audience !== 'blind_reviewer' && sees.includes(audience);
          expect('f_accounts' in projected, `${String(audiences)} ${identity} ${audience}`).toBe(
            expected,
          );
        }
      }
    }
  });
});

describe('changedFieldTypes with file questions', () => {
  /** A copy of the form with field `id` replaced by a question of its label and `change`. */
  const withType = (input: unknown, id: string, change: object) => {
    const copy = JSON.parse(JSON.stringify(input)) as {
      sections: { fields: Record<string, unknown>[] }[];
    };
    for (const section of copy.sections) {
      section.fields = section.fields.map((field) =>
        field['id'] === id ? { id, label: field['label'], ...change } : field,
      );
    }
    return formDefinitionSchema.parse(copy);
  };

  it('finds a field id changed to or from a file question, against every earlier version', () => {
    const orgFile = withType(exampleInput, 'f_orgname', { type: 'file' });
    expect(changedFieldTypes([exampleForm], orgFile)).toEqual(['f_orgname']);
    expect(changedFieldTypes([exampleForm, orgFile], orgFile)).toEqual([]);
    expect(changedFieldTypes([orgFile], exampleForm)).toEqual(['f_orgname']);
    expect(changedFieldTypes([orgFile, budgetForm, documentsForm], exampleForm)).toEqual([
      'f_orgname',
    ]);
    const accountsText = withType(documentsInput, 'f_accounts', { type: 'long_text' });
    expect(changedFieldTypes([documentsForm], accountsText)).toEqual(['f_accounts']);
    expect(changedFieldTypes([accountsText, documentsForm], documentsForm)).toEqual([]);
    const fewerFiles = withType(documentsInput, 'f_photos', { type: 'file', maxFiles: 1 });
    expect(changedFieldTypes([documentsForm], fewerFiles)).toEqual([]);
  });
});
