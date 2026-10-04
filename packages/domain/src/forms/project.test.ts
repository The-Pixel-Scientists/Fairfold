// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { projectionAudiences, type ProjectionAudience } from './audience.ts';
import type { FormField } from './definition.ts';
import { exampleAnswers, exampleForm } from './fixture.ts';
import { projectAnswers } from './project.ts';
import { formDefinitionSchema } from './rules.ts';
import { visibleFields } from './visibility.ts';

/** Written from the rules, not from canSee(), so the two are checked against each other. */
function mayView(field: FormField, audience: ProjectionAudience): boolean {
  if (field.type === 'content') return false;
  if (audience === 'applicant') return true;
  if (field.audiences === 'aggregate_only') return false;
  if (audience === 'staff') return field.audiences.includes('staff');
  const reviewer = field.audiences.includes('reviewer');
  return audience === 'reviewer' ? reviewer : reviewer && !field.identity;
}

describe('projectAnswers', () => {
  it('gives each audience the example answers it may see', () => {
    const keys = (audience: ProjectionAudience) =>
      Object.keys(projectAnswers(exampleForm, exampleAnswers, audience));
    expect(keys('applicant')).toEqual(Object.keys(exampleAnswers));
    expect(keys('staff')).not.toContain('f_ethnicity');
    expect(keys('staff')).toContain('f_email');
    expect(keys('reviewer')).not.toContain('f_email');
    expect(keys('reviewer')).not.toContain('f_ethnicity');
    expect(keys('reviewer')).toContain('f_orgname');
    expect(keys('blind_reviewer')).toEqual([
      'f_charity',
      'f_site',
      'f_kind',
      'f_works',
      'f_amount',
      'f_start',
      'f_people',
      'f_groups',
      'f_region',
      'f_planning',
    ]);
  });

  it('copies values as stored, into a new object', () => {
    const projected = projectAnswers(exampleForm, exampleAnswers, 'staff');
    expect(projected).not.toBe(exampleAnswers);
    expect(projected['f_address']).toBe(exampleAnswers.f_address);
  });

  it('drops unknown keys, inherited properties and answers to fields not shown', () => {
    const answers = JSON.parse(
      '{"f_kind":"equipment","f_works":"old","f_unknown":"x","tenantId":"x","__proto__":{"f_orgname":"x"}}',
    ) as Record<string, unknown>;
    for (const audience of projectionAudiences) {
      expect(projectAnswers(exampleForm, answers, audience)).toEqual({ f_kind: 'equipment' });
    }
  });

  it('gives an audience it does not know nothing', () => {
    const audience = 'auditor' as ProjectionAudience;
    expect(projectAnswers(exampleForm, exampleAnswers, audience)).toEqual({});
  });
});

/** A small seeded generator (mulberry32), so every run checks the same cases. */
function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  return { next, pick };
}

const AUDIENCES = [
  undefined,
  ['applicant', 'staff'],
  ['applicant', 'reviewer'],
  ['applicant'],
  'aggregate_only',
] as const;
const TYPES = ['short_text', 'yes_no', 'single_choice', 'number', 'multiple_choice', 'content'];
const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

/** A random valid form, and random answers to it with junk mixed in. */
function randomCase(seed: number) {
  const { next, pick } = generator(seed);
  const gates: string[] = [];
  let id = 0;
  const sections = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, s) => ({
    id: `s_${s}`,
    title: 'Section',
    fields: Array.from({ length: 1 + Math.floor(next() * 6) }, () => {
      const fieldId = `f_${(id += 1)}`;
      const type = pick(TYPES);
      const conditions =
        gates.length > 0 && next() < 0.4 ? [{ field: pick(gates), equals: true }] : [];
      if (type === 'content') return { id: fieldId, type, body: 'Read this.', conditions };
      // A gate is seen by everyone, so any later field may depend on it.
      const gate = type === 'yes_no' && next() < 0.5;
      const audiences = gate ? undefined : pick(AUDIENCES);
      if (gate) gates.push(fieldId);
      return {
        id: fieldId,
        type,
        label: 'Question',
        identity: !gate && next() < 0.3,
        ...(audiences === undefined ? {} : { audiences }),
        ...(type === 'single_choice' || type === 'multiple_choice' ? { options: OPTIONS } : {}),
        conditions,
      };
    }),
  }));
  const form = formDefinitionSchema.parse({ sections });
  const answers: Record<string, unknown> = { f_999: 'junk', tenantId: 'junk', userId: 'junk' };
  for (const field of form.sections.flatMap((section) => section.fields)) {
    if (next() < 0.2) continue;
    const values: Record<string, unknown> = {
      short_text: 'text',
      yes_no: next() < 0.7,
      single_choice: 'a',
      number: 7,
      multiple_choice: ['b'],
      content: 'not an answer',
    };
    answers[field.id] = values[field.type];
  }
  return { form, answers };
}

// 500 forms, parsed without zod's JIT, can take several seconds on a busy machine.
describe('projectAnswers, on 500 random forms', { timeout: 30_000 }, () => {
  it('keeps exactly the shown answers each audience may see, and nothing else', () => {
    const seen = { hidden: 0, aggregateOnly: 0, identity: 0 };
    for (let seed = 1; seed <= 500; seed += 1) {
      const { form, answers } = randomCase(seed);
      const shown = visibleFields(form, answers);
      for (const field of form.sections.flatMap((section) => section.fields)) {
        if (!Object.hasOwn(answers, field.id) || field.type === 'content') continue;
        if (!shown.includes(field)) seen.hidden += 1;
        else if (field.audiences === 'aggregate_only') seen.aggregateOnly += 1;
        else if (field.identity) seen.identity += 1;
      }
      for (const audience of projectionAudiences) {
        const projected = projectAnswers(form, answers, audience);
        const expected = Object.fromEntries(
          shown
            .filter((field) => mayView(field, audience) && Object.hasOwn(answers, field.id))
            .map((field) => [field.id, answers[field.id]]),
        );
        expect(projected, `seed ${seed}, ${audience}`).toEqual(expected);
        for (const field of form.sections.flatMap((section) => section.fields)) {
          if (!(field.id in projected) || field.type === 'content') continue;
          if (audience !== 'applicant') expect(field.audiences).not.toBe('aggregate_only');
          if (audience === 'blind_reviewer') expect(field.identity).toBe(false);
        }
      }
    }
    // The cases cover answers hidden by conditions, aggregate-only answers and identity answers.
    expect(seen.hidden).toBeGreaterThan(50);
    expect(seen.aggregateOnly).toBeGreaterThan(50);
    expect(seen.identity).toBeGreaterThan(50);
  });
});
