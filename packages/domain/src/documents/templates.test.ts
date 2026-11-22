// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { fieldsOf, type FormField } from '../forms/definition.ts';
import { exampleAnswers, exampleForm } from '../forms/fixture.ts';
import { formDefinitionSchema } from '../forms/rules.ts';
import {
  bodyFields,
  checkTemplateFields,
  documentFields,
  documentRequestSchema,
  templateVersionSchema,
  type TemplateVersion,
} from './templates.ts';

const ID = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const TEMPLATE = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const fields = fieldsOf(exampleForm);

function template(overrides: Partial<TemplateVersion> = {}): TemplateVersion {
  return {
    id: ID,
    templateId: TEMPLATE,
    version: 1,
    kind: 'board_pack',
    audience: 'staff',
    title: 'Board pack',
    mergeFields: ['f_orgname', 'f_amount'],
    body: [
      { type: 'logo', alt: 'Northfield Trust' },
      { type: 'heading', level: 1, text: 'Applications for the board' },
      {
        type: 'paragraph',
        content: [{ text: 'Organisation: ' }, { field: 'f_orgname' }],
      },
      {
        type: 'table',
        header: ['Amount asked for'],
        rows: [[[{ field: 'f_amount' }]]],
      },
      { type: 'page_break' },
    ],
    ...overrides,
  };
}

describe('templateVersionSchema', () => {
  it('takes a closed set of blocks of plain text and merge fields', () => {
    expect(templateVersionSchema.parse(template())).toEqual(template());
    expect(bodyFields(template().body)).toEqual(['f_orgname', 'f_amount']);
  });

  it('refuses merge fields that differ from those the body uses, or repeat', () => {
    for (const mergeFields of [
      ['f_orgname'],
      ['f_orgname', 'f_amount', 'f_site'],
      ['f_orgname', 'f_amount', 'f_amount'],
    ]) {
      expect(templateVersionSchema.safeParse(template({ mergeFields })).success).toBe(false);
    }
  });

  it('refuses markup, scripts, links, unknown blocks and hidden characters', () => {
    const bodies = [
      [{ type: 'html', html: '<script>fetch("https://example.org")</script>' }],
      [{ type: 'image', src: 'https://example.org/x.png', alt: 'x' }],
      [{ type: 'paragraph', content: [{ text: 'x', link: 'https://example.org' }] }],
      [{ type: 'paragraph', content: [{ field: 'name' }] }],
      [{ type: 'heading', level: 1, text: 'Line one\nLine two' }],
      [{ type: 'heading', level: 1, text: 'Board\u202Epack' }],
      [{ type: 'heading', level: 4, text: 'Too deep' }],
      [{ type: 'table', header: ['A', 'B'], rows: [[[{ text: 'one cell' }]]] }],
    ];
    for (const body of bodies) {
      const parsed = templateVersionSchema.safeParse({ ...template(), mergeFields: [], body });
      expect(parsed.success, JSON.stringify(body)).toBe(false);
    }
  });

  it('refuses a kind or audience that is not listed, and an empty or oversized body', () => {
    const paragraph = { type: 'paragraph', content: [{ text: 'x'.repeat(2000) }] };
    for (const overrides of [
      { kind: 'letter' },
      { audience: 'public' },
      { body: [], mergeFields: [] },
      { body: Array.from({ length: 101 }, () => paragraph), mergeFields: [] },
    ]) {
      const parsed = templateVersionSchema.safeParse({ ...template(), ...overrides });
      expect(parsed.success, Object.keys(overrides).join()).toBe(false);
    }
  });
});

describe('checkTemplateFields', () => {
  it('allows the fields the audience may see', () => {
    expect(checkTemplateFields(template(), fields)).toEqual([]);
    const reviewer = { audience: 'reviewer', mergeFields: ['f_orgname', 'f_amount'] } as const;
    expect(checkTemplateFields(reviewer, fields)).toEqual([]);
  });

  it('refuses an identity field in a blind reviewer document', () => {
    const blind = { audience: 'blind_reviewer', mergeFields: ['f_orgname', 'f_amount'] } as const;
    expect(checkTemplateFields(blind, fields)).toEqual([
      { fieldId: 'f_orgname', reason: 'not_visible' },
    ]);
  });

  it('refuses a field the version hides from reviewers', () => {
    const reviewer = { audience: 'reviewer', mergeFields: ['f_email'] } as const;
    expect(checkTemplateFields(reviewer, fields)).toEqual([
      { fieldId: 'f_email', reason: 'not_visible' },
    ]);
  });

  it('refuses a monitoring answer for staff, and for the applicant who gave it', () => {
    for (const audience of ['staff', 'applicant', 'respondent'] as const) {
      expect(checkTemplateFields({ audience, mergeFields: ['f_ethnicity'] }, fields)).toEqual([
        { fieldId: 'f_ethnicity', reason: 'restricted' },
      ]);
    }
  });

  it('refuses a special category answer whatever its audiences say', () => {
    const special = {
      ...fields.find((field) => field.id === 'f_region'),
      classification: 'special_category',
    } as FormField;
    for (const audience of ['staff', 'applicant'] as const) {
      expect(checkTemplateFields({ audience, mergeFields: ['f_region'] }, [special])).toEqual([
        { fieldId: 'f_region', reason: 'restricted' },
      ]);
    }
  });

  it('refuses a field that is not a question on the form, or a content block', () => {
    const staff = { audience: 'staff', mergeFields: ['f_missing', 'f_intro'] } as const;
    expect(checkTemplateFields(staff, fields)).toEqual([
      { fieldId: 'f_missing', reason: 'unknown' },
      { fieldId: 'f_intro', reason: 'unknown' },
    ]);
  });
});

describe('documentFields', () => {
  const all = ['f_orgname', 'f_email', 'f_amount', 'f_ethnicity'];

  it("prints Not shown, never the value, for a field the record's version hides from reviewers", () => {
    const reviewer = { audience: 'reviewer', mergeFields: ['f_orgname', 'f_email'] } as const;
    expect(documentFields(reviewer, exampleForm, exampleAnswers, 'staff', all)).toEqual({
      values: { f_orgname: 'Northfield Community Trust' },
      notShown: ['f_email'],
    });
  });

  it('keeps identity fields out of a blind reviewer document', () => {
    const blind = { audience: 'blind_reviewer', mergeFields: ['f_orgname', 'f_amount'] } as const;
    expect(documentFields(blind, exampleForm, exampleAnswers, 'staff', all)).toEqual({
      values: { f_amount: exampleAnswers.f_amount },
      notShown: ['f_orgname'],
    });
  });

  it("never fills a field the requester may not see, or that the job's field list leaves out", () => {
    const staff = { audience: 'staff', mergeFields: ['f_email', 'f_amount'] } as const;
    expect(documentFields(staff, exampleForm, exampleAnswers, 'reviewer', all)).toEqual({
      values: { f_amount: exampleAnswers.f_amount },
      notShown: ['f_email'],
    });
    expect(documentFields(staff, exampleForm, exampleAnswers, 'staff', ['f_email'])).toEqual({
      values: { f_email: exampleAnswers.f_email },
      notShown: ['f_amount'],
    });
  });

  it("follows each record's pinned version, which may now restrict a field", () => {
    const later = formDefinitionSchema.parse({
      sections: [
        {
          id: 's_about',
          title: 'About',
          fields: [
            {
              id: 'f_orgname',
              type: 'single_choice',
              label: 'Which group?',
              audiences: 'aggregate_only',
              options: [
                { value: 'one', label: 'Group one' },
                { value: 'two', label: 'Group two' },
              ],
            },
          ],
        },
      ],
    });
    const applicant = { audience: 'applicant', mergeFields: ['f_orgname'] } as const;
    expect(documentFields(applicant, later, exampleAnswers, 'staff', all)).toEqual({
      values: {},
      notShown: ['f_orgname'],
    });
  });

  it('leaves a field with no answer shown out of both lists', () => {
    const staff = { audience: 'staff', mergeFields: ['f_works'] } as const;
    const answers = { ...exampleAnswers, f_kind: 'equipment' };
    expect(documentFields(staff, exampleForm, answers, 'staff', ['f_works'])).toEqual({
      values: {},
      notShown: [],
    });
  });
});

describe('documentRequestSchema', () => {
  it('holds ids and the kind only, never fields or layout', () => {
    const request = { templateVersionId: ID, kind: 'board_pack', subjectIds: [TEMPLATE] };
    expect(documentRequestSchema.parse(request)).toEqual(request);
    for (const refused of [
      { ...request, fields: ['f_orgname'] },
      { ...request, body: [] },
      { ...request, subjectIds: [] },
      { ...request, subjectIds: ['Northfield'] },
    ]) {
      expect(documentRequestSchema.safeParse(refused).success).toBe(false);
    }
  });
});
