// SPDX-License-Identifier: AGPL-3.0-or-later

import { formDefinitionSchema, MAX_FIELDS } from '@pixel-scientists/domain/forms';
import { configEntityTypes } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { grantsConfigEntityTypes } from '../programme/config.ts';
import {
  formConfigEntityType,
  formDiff,
  formVersionDiffSchema,
  MAX_FORM_CHANGES,
} from './config.ts';

const options = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const first = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_about',
      title: 'About you',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Organisation name', required: true },
        { id: 'f_kind', type: 'single_choice', label: 'Are you a charity?', options },
      ],
    },
  ],
});

/** A form at the question limit, every question a table with every value set. */
function largest(prefix: string) {
  return formDefinitionSchema.parse({
    sections: Array.from({ length: MAX_FIELDS / 100 }, (_, s) => ({
      id: `s_${prefix}${String(s)}`,
      title: 'Costs',
      introduction: 'What the project costs.',
      fields: Array.from({ length: 100 }, (_, f) => ({
        id: `f_${prefix}${String(s * 100 + f)}`,
        type: 'table',
        label: 'Costs',
        hint: 'One row per cost.',
        rowNoun: 'cost',
        columns: [{ id: 'c_item', type: 'short_text', label: 'Item' }],
      })),
    })),
  });
}

describe('form configuration versions', () => {
  it('have their own entity type, in the form app.config_version checks', () => {
    expect(formConfigEntityType).toMatch(/^grants\.[a-z_]+$/);
    expect([...grantsConfigEntityTypes, ...configEntityTypes]).not.toContain(formConfigEntityType);
  });
});

describe('formDiff', () => {
  it('records every value of the first published version by section and field id', () => {
    const { changes } = formDiff(null, first);
    expect(changes).toEqual([
      { path: 'sections.s_about.title', from: null, to: 'About you' },
      { path: 'sections.s_about.conditions', from: null, to: '[]' },
      { path: 'sections.s_about.position', from: null, to: 1 },
      { path: 'sections.s_about.fields', from: null, to: 'f_name,f_kind' },
      { path: 'fields.f_name.label', from: null, to: 'Organisation name' },
      { path: 'fields.f_name.required', from: null, to: true },
      { path: 'fields.f_name.identity', from: null, to: false },
      { path: 'fields.f_name.audiences', from: null, to: '["applicant","staff","reviewer"]' },
      { path: 'fields.f_name.conditions', from: null, to: '[]' },
      { path: 'fields.f_name.type', from: null, to: 'short_text' },
      { path: 'fields.f_kind.label', from: null, to: 'Are you a charity?' },
      { path: 'fields.f_kind.required', from: null, to: false },
      { path: 'fields.f_kind.identity', from: null, to: false },
      { path: 'fields.f_kind.audiences', from: null, to: '["applicant","staff","reviewer"]' },
      { path: 'fields.f_kind.conditions', from: null, to: '[]' },
      { path: 'fields.f_kind.type', from: null, to: 'single_choice' },
      {
        path: 'fields.f_kind.options',
        from: null,
        to: '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
      },
    ]);
    expect(formVersionDiffSchema.parse({ changes })).toEqual({ changes });
  });

  it('lists only what changed against the previous published version', () => {
    const [section] = first.sections;
    const next = formDefinitionSchema.parse({
      sections: [
        {
          ...section,
          introduction: 'Tell us who you are.',
          fields: [
            { ...section?.fields[1], label: 'Is your organisation a registered charity?' },
            { id: 'f_email', type: 'email', label: 'Email address', identity: true },
          ],
        },
      ],
    });
    expect(formDiff(first, next).changes).toEqual([
      { path: 'sections.s_about.fields', from: 'f_name,f_kind', to: 'f_kind,f_email' },
      {
        path: 'fields.f_name.label',
        from: 'Organisation name',
        to: null,
      },
      { path: 'fields.f_name.required', from: true, to: null },
      { path: 'fields.f_name.identity', from: false, to: null },
      { path: 'fields.f_name.audiences', from: '["applicant","staff","reviewer"]', to: null },
      { path: 'fields.f_name.conditions', from: '[]', to: null },
      { path: 'fields.f_name.type', from: 'short_text', to: null },
      {
        path: 'fields.f_kind.label',
        from: 'Are you a charity?',
        to: 'Is your organisation a registered charity?',
      },
      { path: 'sections.s_about.introduction', from: null, to: 'Tell us who you are.' },
      { path: 'fields.f_email.label', from: null, to: 'Email address' },
      { path: 'fields.f_email.required', from: null, to: false },
      { path: 'fields.f_email.identity', from: null, to: true },
      { path: 'fields.f_email.audiences', from: null, to: '["applicant","staff","reviewer"]' },
      { path: 'fields.f_email.conditions', from: null, to: '[]' },
      { path: 'fields.f_email.type', from: null, to: 'email' },
    ]);
  });

  it('records a publication that changes nothing with no changes', () => {
    expect(formDiff(first, first)).toEqual({ changes: [] });
    expect(formVersionDiffSchema.safeParse({ changes: [] }).success).toBe(true);
  });

  it('finds no change in the same form with its keys in another order, as jsonb stores them', () => {
    /** Keys shortest first, then bytewise, at every level, as Postgres jsonb orders them. */
    const asJsonb = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(asJsonb);
      if (typeof value !== 'object' || value === null) return value;
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1))
          .map(([key, item]) => [key, asJsonb(item)]),
      );
    };
    const stored = asJsonb(first) as typeof first;
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(first));
    expect(formDiff(stored, first)).toEqual({ changes: [] });
    expect(formDiff(first, stored)).toEqual({ changes: [] });
  });

  it('holds two of the largest forms with no id in common', () => {
    const diff = formDiff(largest('a'), largest('b'));
    expect(diff.changes.length).toBeLessThanOrEqual(MAX_FORM_CHANGES);
    expect(formVersionDiffSchema.safeParse(diff).success).toBe(true);
  });

  it('refuses a path that is not a section or field id and a key', () => {
    for (const path of ['sections.0.title', 'fields.f_name', 'title', 'fields.f_name.label.x']) {
      const changes = [{ path, from: null, to: 'x' }];
      expect(formVersionDiffSchema.safeParse({ changes }).success, path).toBe(false);
    }
  });
});
