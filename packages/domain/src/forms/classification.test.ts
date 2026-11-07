// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messageForIssue } from '../platform/messages.ts';
import { canSee, projectionAudiences, type ProjectionAudience } from './audience.ts';
import {
  answerClassifications,
  answersUpTo,
  classificationOf,
  loweredClassifications,
} from './classification.ts';
import { classifications, fieldSchema, questionsOf, type Classification } from './definition.ts';
import {
  budgetForm,
  budgetInput,
  documentsAnswers,
  documentsForm,
  documentsInput,
  exampleAnswers,
  exampleForm,
  exampleInput,
} from './fixture.ts';
import { formMessages as m } from './messages.ts';
import { projectAnswers } from './project.ts';
import { definitionProblems, formDefinitionSchema, parseDefinition } from './rules.ts';

type Fields = Record<string, unknown>[];

/** A copy of a form with each named field changed, by id. */
function withFields(input: unknown, changes: Record<string, object>): unknown {
  const copy = JSON.parse(JSON.stringify(input)) as { sections: { fields: Fields }[] };
  for (const section of copy.sections) {
    section.fields = section.fields.map((field) => ({
      ...field,
      ...changes[field['id'] as string],
    }));
  }
  return copy;
}

function parsed(input: unknown) {
  return formDefinitionSchema.parse(input);
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

const below = (ceiling: Classification) =>
  classifications.slice(0, classifications.indexOf(ceiling));

describe('classificationOf', () => {
  it('gives every published test form the defaults, which over-classify', () => {
    const personal = (form: typeof exampleForm) =>
      Object.fromEntries(questionsOf(form).map((field) => [field.id, 'personal']));
    expect(answerClassifications(exampleForm)).toEqual({
      ...personal(exampleForm),
      f_ethnicity: 'special_category',
    });
    expect(Object.keys(answerClassifications(exampleForm))).not.toContain('f_intro');
    expect(answerClassifications(budgetForm)).toEqual(personal(budgetForm));
    expect(answerClassifications(documentsForm)).toEqual(personal(documentsForm));
  });

  it('writes no default into a parsed definition', () => {
    for (const form of [exampleForm, budgetForm, documentsForm]) {
      for (const field of questionsOf(form)) expect(field).not.toHaveProperty('classification');
    }
  });

  it('returns the stored level, on any question type, tables and files included', () => {
    const form = parsed(
      withFields(exampleInput, {
        f_site: { classification: 'public' },
        f_amount: { classification: 'internal' },
      }),
    );
    expect(answerClassifications(form)).toMatchObject({ f_site: 'public', f_amount: 'internal' });
    const budget = parsed(withFields(budgetInput, { f_budget: { classification: 'internal' } }));
    expect(answerClassifications(budget)).toEqual({ f_budget: 'internal', f_trustees: 'personal' });
    const documents = parsed(
      withFields(documentsInput, { f_accounts: { classification: 'personal' } }),
    );
    const accounts = questionsOf(documents)[0];
    expect(accounts && classificationOf(accounts)).toBe('personal');
  });

  it('refuses a level it does not know, and any level on a content block', () => {
    expect(
      parseDefinition(withFields(exampleInput, { f_site: { classification: 'secret' } })).success,
    ).toBe(false);
    expect(
      parseDefinition(withFields(exampleInput, { f_intro: { classification: 'public' } })).success,
    ).toBe(false);
  });
});

describe('definitionProblems on classification', () => {
  it('finds none in any form published before classification', () => {
    for (const form of [exampleForm, budgetForm, documentsForm]) {
      expect(definitionProblems(form)).toEqual([]);
    }
  });

  it('refuses an identity or file question below personal', () => {
    for (const level of below('personal')) {
      expect(refusals(withFields(exampleInput, { f_orgname: { classification: level } }))).toEqual([
        { path: 'sections.0.fields.1.classification', message: m.identityClassification },
      ]);
      expect(refusals(withFields(budgetInput, { f_trustees: { classification: level } }))).toEqual([
        { path: 'sections.0.fields.1.classification', message: m.identityClassification },
      ]);
      expect(
        refusals(withFields(documentsInput, { f_accounts: { classification: level } })),
      ).toEqual([{ path: 'sections.0.fields.0.classification', message: m.fileClassification }]);
    }
  });

  it('ties special category to aggregate only, both ways', () => {
    expect(
      refusals(withFields(exampleInput, { f_site: { classification: 'special_category' } })),
    ).toEqual([{ path: 'sections.0.fields.5.audiences', message: m.specialAudiences }]);
    expect(
      refusals(withFields(budgetInput, { f_budget: { classification: 'special_category' } })),
    ).toEqual([{ path: 'sections.0.fields.0.audiences', message: m.specialAudiences }]);
    for (const level of below('special_category')) {
      expect(
        refusals(withFields(exampleInput, { f_ethnicity: { classification: level } })),
      ).toEqual([
        { path: 'sections.3.fields.1.classification', message: m.aggregateClassification },
      ]);
    }
    const stated = withFields(exampleInput, {
      f_ethnicity: { classification: 'special_category' },
    });
    expect(refusals(stated)).toEqual([]);
  });
});

describe('answersUpTo', () => {
  const form = parsed(
    withFields(exampleInput, {
      f_site: { classification: 'public' },
      f_amount: { classification: 'internal' },
    }),
  );

  it('keeps the shown answers classified at or below the ceiling', () => {
    expect(answersUpTo(form, exampleAnswers, 'public')).toEqual({ f_site: exampleAnswers.f_site });
    expect(answersUpTo(form, exampleAnswers, 'internal')).toEqual({
      f_site: exampleAnswers.f_site,
      f_amount: exampleAnswers.f_amount,
    });
    const { f_ethnicity, ...personal } = exampleAnswers;
    expect(answersUpTo(form, exampleAnswers, 'personal')).toEqual(personal);
    expect(answersUpTo(form, exampleAnswers, 'special_category')).toEqual({
      ...personal,
      f_ethnicity,
    });
  });

  it('never lets a special category answer through a lower ceiling', () => {
    for (const ceiling of below('special_category')) {
      expect(answersUpTo(exampleForm, exampleAnswers, ceiling)).not.toHaveProperty('f_ethnicity');
    }
  });

  it('drops unknown keys, inherited properties, answers not shown and every answer for an unknown ceiling', () => {
    const answers = JSON.parse(
      '{"f_kind":"equipment","f_works":"old","f_unknown":"x","tenantId":"x","__proto__":{"f_orgname":"x"}}',
    ) as Record<string, unknown>;
    for (const ceiling of classifications) {
      expect(answersUpTo(form, answers, ceiling)).toEqual(
        ceiling === 'public' || ceiling === 'internal' ? {} : { f_kind: 'equipment' },
      );
    }
    expect(answersUpTo(form, exampleAnswers, 'secret' as Classification)).toEqual({});
  });

  it('copies values as stored, into a new object', () => {
    const kept = answersUpTo(documentsForm, documentsAnswers, 'personal');
    expect(kept).toEqual(documentsAnswers);
    expect(kept).not.toBe(documentsAnswers);
    expect(kept['f_photos']).toBe(documentsAnswers.f_photos);
  });
});

describe('loweredClassifications', () => {
  const at = (changes: Record<string, object>) => parsed(withFields(exampleInput, changes));
  const sitePublic = at({ f_site: { classification: 'public' } });
  const siteInternal = at({ f_site: { classification: 'internal' } });
  const sitePersonal = at({ f_site: { classification: 'personal' } });

  it('finds an id classified lower than in any earlier version', () => {
    expect(loweredClassifications([exampleForm], siteInternal)).toEqual(['f_site']);
    expect(loweredClassifications([sitePersonal, siteInternal], sitePublic)).toEqual(['f_site']);
    expect(loweredClassifications([exampleForm, sitePublic], sitePublic)).toEqual(['f_site']);
    expect(loweredClassifications([sitePersonal, budgetForm], siteInternal)).toEqual(['f_site']);
  });

  it('allows the same or a higher level, a stated default and a new id', () => {
    expect(loweredClassifications([exampleForm], exampleForm)).toEqual([]);
    expect(loweredClassifications([exampleForm], sitePersonal)).toEqual([]);
    expect(loweredClassifications([sitePublic, siteInternal], exampleForm)).toEqual([]);
    expect(loweredClassifications([budgetForm, documentsForm], sitePublic)).toEqual([]);
    expect(loweredClassifications([], sitePublic)).toEqual([]);
  });
});

/** One question of each type, with what its type needs to parse. */
function everyType(audiences: unknown): unknown {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];
  const extras: Record<string, object> = {
    single_choice: { options },
    dropdown: { options },
    multiple_choice: { options },
    table: { rowNoun: 'row', columns: [{ id: 'c_a', type: 'short_text', label: 'A' }] },
  };
  const types = fieldSchema.options
    .map((option) => option.shape.type.value)
    .filter((type) => type !== 'content' && !(type === 'file' && audiences === 'aggregate_only'));
  expect(types.length).toBeGreaterThan(10);
  return {
    sections: [
      {
        id: 's_all',
        title: 'Every type',
        fields: types.map((type) => ({
          id: `f_${type.replace('_', '')}`,
          type,
          label: type,
          ...extras[type],
          ...(audiences === undefined ? {} : { audiences }),
        })),
      },
    ],
  };
}

describe('the respondent audience', () => {
  it('sees what the applicant sees, aggregate-only answers included, on every question type', () => {
    const sets = [
      undefined,
      ['applicant'],
      ['applicant', 'staff'],
      ['applicant', 'reviewer'],
      'aggregate_only',
    ];
    for (const audiences of sets) {
      for (const field of parsed(everyType(audiences)).sections[0]?.fields ?? []) {
        expect(canSee(field, 'respondent'), field.id).toBe(true);
        expect(canSee(field, 'applicant'), field.id).toBe(true);
      }
    }
    expect(projectAnswers(exampleForm, exampleAnswers, 'respondent')).toEqual(
      projectAnswers(exampleForm, exampleAnswers, 'applicant'),
    );
  });

  it('leaves aggregate-only answers away from staff and reviewers, on every question type', () => {
    for (const field of parsed(everyType('aggregate_only')).sections[0]?.fields ?? []) {
      for (const audience of projectionAudiences) {
        const may = audience === 'applicant' || audience === 'respondent';
        expect(canSee(field, audience), `${field.id} ${audience}`).toBe(may);
      }
      expect(canSee(field, 'auditor' as ProjectionAudience)).toBe(false);
    }
  });
});
