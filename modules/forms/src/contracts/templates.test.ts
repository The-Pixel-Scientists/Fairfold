// SPDX-License-Identifier: AGPL-3.0-or-later

import { definitionProblems, parseDefinition, questionsOf } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { publishProblems } from './forms.ts';
import { feedbackTemplates, feedbackTemplateSchema } from './templates.ts';

describe('feedback templates', () => {
  it('have their own ids and a version', () => {
    expect(new Set(feedbackTemplates.map((template) => template.id)).size).toBe(
      feedbackTemplates.length,
    );
    for (const template of feedbackTemplates) {
      expect(template.version).toBe(1);
      expect(feedbackTemplateSchema.parse(template)).toEqual(template);
    }
  });

  it('parse with the form engine and break none of its rules', () => {
    for (const { title, definition } of feedbackTemplates) {
      expect(parseDefinition(definition).success, title).toBe(true);
      expect(definitionProblems(definition), title).toEqual([]);
    }
  });

  it('classify every question, ask for no special category data or files, and can be anonymous', () => {
    for (const { title, definition } of feedbackTemplates) {
      for (const question of questionsOf(definition)) {
        expect(question.classification, question.id).toMatch(/^(?:internal|personal)$/);
        expect(question.type, question.id).not.toBe('file');
        expect(question.audiences, question.id).not.toBe('aggregate_only');
      }
      expect(publishProblems([], definition, 'both'), title).toEqual([]);
    }
  });

  it('use plain, sentence case words', () => {
    for (const { title, description, definition } of feedbackTemplates) {
      for (const text of [title, ...questionsOf(definition).map((question) => question.label)]) {
        expect(text, text).toMatch(/^[A-Z][^A-Z]*$/);
      }
      expect(description).toMatch(/^[A-Z].*\.$/);
    }
  });
});
