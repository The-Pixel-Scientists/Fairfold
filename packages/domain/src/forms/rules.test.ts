// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { requestProblems, responseProblems } from '../api/schema-rules.ts';
import { messageForIssue } from '../platform/messages.ts';
import { answersSchema } from './answers.ts';
import { exampleForm, exampleInput } from './fixture.ts';
import { formMessages as m, MAX_FIELDS } from './messages.ts';
import { changedFieldTypes, formDefinitionSchema, parseDefinition } from './rules.ts';

type Input = typeof exampleInput;

/** A copy of the example with one change, made by `change`. */
function variant(change: (input: Input) => void): unknown {
  const copy = JSON.parse(JSON.stringify(exampleInput)) as Input;
  change(copy);
  return copy;
}

/** The messages and paths of everything parseDefinition() refuses. */
function refusals(input: unknown): { path: string; message: string }[] {
  const result = parseDefinition(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: messageForIssue(issue),
      }));
}

const yesNo = (id: string, extra: object = {}) => ({ id, type: 'yes_no', label: id, ...extra });

describe('parseDefinition', () => {
  it('takes the example form and writes out every default', () => {
    expect(refusals(exampleInput)).toEqual([]);
    const name = exampleForm.sections[0]?.fields[1];
    expect(name).toMatchObject({
      required: true,
      identity: true,
      audiences: ['applicant', 'staff', 'reviewer'],
      conditions: [],
    });
    expect(exampleForm.sections[1]?.fields[2]).toMatchObject({
      currency: 'GBP',
      minMinor: 500_000,
    });
  });

  it('refuses a field type it does not know, such as a file upload', () => {
    const input = variant((form) => {
      (form.sections[0]?.fields as object[]).push({ id: 'f_file', type: 'file', label: 'File' });
    });
    expect(parseDefinition(input).success).toBe(false);
  });

  it('refuses an id used twice, by sections or fields', () => {
    const field = variant((form) => {
      (form.sections[1]?.fields as object[]).push(yesNo('f_orgname'));
    });
    expect(refusals(field)).toEqual([{ path: 'sections.1.fields.7.id', message: m.idUsedTwice }]);
    const section = variant((form) => {
      (form.sections[1] as { id: string }).id = 's_about';
    });
    expect(refusals(section)).toEqual([{ path: 'sections.1.id', message: m.idUsedTwice }]);
  });

  it('refuses ids that are not stable field or section ids', () => {
    for (const id of ['orgname', 'f_Org', 'f_', 's_about', 'f_toString!']) {
      const input = variant((form) => {
        (form.sections[0]?.fields[1] as { id: string }).id = id;
      });
      expect(parseDefinition(input).success, id).toBe(false);
    }
  });

  it('refuses a condition on a later, missing or the same question, so there is no cycle', () => {
    for (const field of ['f_region', 'f_missing', 'f_works']) {
      const input = variant((form) => {
        (form.sections[1]?.fields[1] as { conditions: object[] }).conditions = [
          { field, equals: 'north' },
        ];
      });
      expect(refusals(input)).toContainEqual({
        path: 'sections.1.fields.1.conditions.0.field',
        message: m.conditionSource,
      });
    }
    const sameSection = variant((form) => {
      (form.sections[2] as { conditions: object[] }).conditions = [
        { field: 'f_planning', equals: true },
      ];
    });
    expect(refusals(sameSection)).toContainEqual({
      path: 'sections.2.conditions.0.field',
      message: m.conditionSource,
    });
  });

  it('refuses a condition on a question that is not a choice, or with an answer it cannot have', () => {
    const condition = (value: object) =>
      variant((form) => {
        (form.sections[1]?.fields[1] as { conditions: object[] }).conditions = [value];
      });
    const path = 'sections.1.fields.1.conditions.0';
    expect(refusals(condition({ field: 'f_orgname', equals: 'x' }))).toContainEqual({
      path,
      message: m.conditionType,
    });
    for (const value of [
      { field: 'f_kind', equals: 'castle' },
      { field: 'f_kind', equals: true },
      { field: 'f_kind', includes: 'building' },
      { field: 'f_charity', equals: 'yes' },
    ]) {
      expect(refusals(condition(value))).toContainEqual({ path, message: m.conditionValue });
    }
  });

  it('takes an includes condition on a multiple choice question', () => {
    const input = variant((form) => {
      (form.sections[1]?.fields[6] as { conditions: object[] }).conditions = [
        { field: 'f_groups', includes: 'young' },
      ];
    });
    expect(refusals(input)).toEqual([]);
  });

  it('refuses a condition that would reveal an answer to someone who may not see it', () => {
    const reveals = { path: 'sections.3.fields.2.conditions', message: m.conditionReveals };
    const dependsOn = (field: string, equals: string | boolean, extra: object = {}) =>
      variant((form) => {
        (form.sections[3]?.fields as object[]).push(
          yesNo('f_more', { conditions: [{ field, equals }], ...extra }),
        );
      });
    // An aggregate-only answer, an identity answer to blind reviewers, a staff-only answer to reviewers.
    expect(refusals(dependsOn('f_ethnicity', 'one'))).toEqual([reveals]);
    const identitySource = variant((form) => {
      (form.sections[0]?.fields[0] as { identity: boolean }).identity = true;
      (form.sections[3]?.fields as object[]).push(
        yesNo('f_more', { conditions: [{ field: 'f_charity', equals: true }] }),
      );
    });
    expect(refusals(identitySource)).toEqual([reveals]);
    const staffOnly = variant((form) => {
      (form.sections[0]?.fields[0] as { audiences: string[] }).audiences = ['applicant', 'staff'];
      (form.sections[3]?.fields as object[]).push(
        yesNo('f_more', { conditions: [{ field: 'f_charity', equals: true }] }),
      );
    });
    expect(refusals(staffOnly)).toEqual([reveals]);
    // Fine when the dependent field is no wider than its source.
    expect(refusals(dependsOn('f_ethnicity', 'one', { audiences: 'aggregate_only' }))).toEqual([]);
  });

  it('checks section conditions against every field in the section', () => {
    const input = variant((form) => {
      (form.sections[0]?.fields[0] as { audiences: string[] }).audiences = ['applicant', 'staff'];
      (form.sections[2] as { conditions: object[] }).conditions = [
        { field: 'f_charity', equals: true },
      ];
    });
    expect(refusals(input)).toContainEqual({
      path: 'sections.2.fields.0.conditions',
      message: m.conditionReveals,
    });
  });

  it('refuses eligibility on any type but single choice and yes or no', () => {
    for (const type of ['dropdown', 'multiple_choice', 'short_text']) {
      const input = variant((form) => {
        const field = form.sections[1]?.fields[6] as Record<string, unknown>;
        field['type'] = type;
        field['eligibility'] = { stopValues: ['north'], explanation: 'No.' };
      });
      expect(parseDefinition(input).success, type).toBe(false);
    }
  });

  it('needs eligibility questions required, seen by staff, and stopping on some answers only', () => {
    const eligibility = (change: (field: Record<string, unknown>) => void) =>
      refusals(
        variant((form) => {
          change(form.sections[1]?.fields[0] as Record<string, unknown>);
        }),
      ).map((refusal) => refusal.message);
    expect(eligibility((field) => (field['required'] = false))).toEqual([m.eligibilityRequired]);
    expect(eligibility((field) => (field['audiences'] = 'aggregate_only'))).toContain(
      m.eligibilityStaff,
    );
    // Hiding it from staff also hides the question that decides whether f_works shows.
    expect(eligibility((field) => (field['audiences'] = ['applicant', 'reviewer']))).toEqual([
      m.eligibilityStaff,
      m.conditionReveals,
      m.conditionReveals,
    ]);
    const stop = (stopValues: string[]) => (field: Record<string, unknown>) =>
      (field['eligibility'] = { stopValues, explanation: 'No.' });
    expect(eligibility(stop(['castle']))).toEqual([m.eligibilityValues]);
    expect(eligibility(stop(['building', 'equipment', 'loans']))).toEqual([m.eligibilityAll]);
  });

  it('refuses audiences without the applicant, or with one listed twice', () => {
    for (const audiences of [['staff'], ['applicant', 'staff', 'staff'], [], 'everyone']) {
      const input = variant((form) => {
        (form.sections[0]?.fields[1] as { audiences: unknown }).audiences = audiences;
      });
      expect(parseDefinition(input).success, String(audiences)).toBe(false);
    }
  });

  it('refuses duplicate options and limits the wrong way round', () => {
    const field = (index: number, change: (field: Record<string, unknown>) => void) =>
      refusals(
        variant((form) => {
          change(form.sections[1]?.fields[index] as Record<string, unknown>);
        }),
      ).map((refusal) => refusal.message);
    expect(
      field(6, (dropdown) => {
        dropdown['options'] = [
          { value: 'north', label: 'North' },
          { value: 'north', label: 'Also north' },
        ];
      }),
    ).toEqual([m.optionsUnique]);
    expect(field(4, (number) => (number['min'] = 200_000))).toEqual([m.limitOrder]);
    expect(field(2, (amount) => (amount['maxMinor'] = 100))).toEqual([m.limitOrder]);
    expect(field(5, (choice) => (choice['minSelections'] = 3))).toEqual([m.limitOrder]);
    expect(field(5, (choice) => (choice['maxSelections'] = 4))).toEqual([m.selectionsOptions]);
    expect(field(2, (amount) => (amount['minMinor'] = -1))).not.toEqual([]);
  });

  it('refuses more than the most fields a form may hold', () => {
    const sections = Array.from({ length: 4 }, (_, s) => ({
      id: `s_${s}`,
      title: 'Section',
      fields: Array.from({ length: 76 }, (_, f) => yesNo(`f_${s}x${f}`)),
    }));
    expect(refusals({ sections })).toEqual([{ path: 'sections', message: m.tooManyFields }]);
    expect(MAX_FIELDS).toBe(300);
  });
});

describe('changedFieldTypes', () => {
  it('finds an id that a new version gives another type, against the latest version with it', () => {
    const asNumber = formDefinitionSchema.parse(
      variant((form) => {
        const field = form.sections[1]?.fields[6] as Record<string, unknown>;
        Object.assign(field, { type: 'number', options: undefined });
        delete field['options'];
      }),
    );
    expect(changedFieldTypes([exampleForm], exampleForm)).toEqual([]);
    expect(changedFieldTypes([exampleForm], asNumber)).toEqual(['f_region']);
    expect(changedFieldTypes([exampleForm, asNumber], asNumber)).toEqual([]);
  });
});

describe('route schemas', () => {
  it('keep the route rules, so the builder and application contracts can carry them', () => {
    const path = '/console/forms/:formId';
    expect(requestProblems(path, 'body', formDefinitionSchema)).toEqual([]);
    expect(responseProblems('200', formDefinitionSchema)).toEqual([]);
    expect(requestProblems(path, 'body', z.strictObject({ answers: answersSchema }))).toEqual([]);
  });
});
