// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Published versions are immutable, so a change to the engine must leave
// every earlier version parsing and projecting exactly as it did. The example
// form's snapshot was written by the engine before the table question
// existed, the budget form's before the file question, and the documents
// form's before per-field classification and the respondent audience.

import { expect, it } from 'vitest';

import { canSee } from './audience.ts';
import {
  budgetAnswers,
  budgetInput,
  documentsAnswers,
  documentsInput,
  exampleAnswers,
  exampleInput,
} from './fixture.ts';
import { projectAnswers } from './project.ts';
import { parseDefinition } from './rules.ts';

/** The audiences MVP1 projected for, which the snapshots pin. */
const mvp1Audiences = ['applicant', 'staff', 'reviewer', 'blind_reviewer'] as const;

function published(input: unknown, answers: Record<string, unknown>): string {
  const parsed = parseDefinition(input);
  if (!parsed.success) throw parsed.error;
  const projections = Object.fromEntries(
    mvp1Audiences.map((audience) => [audience, projectAnswers(parsed.data, answers, audience)]),
  );
  return `${JSON.stringify({ definition: parsed.data, projections }, null, 2)}\n`;
}

it('parses and projects the example form exactly as before the table question', async () => {
  await expect(published(exampleInput, exampleAnswers)).toMatchFileSnapshot(
    './__snapshots__/published.txt',
  );
});

it('parses and projects the budget form exactly as before the file question', async () => {
  await expect(published(budgetInput, budgetAnswers)).toMatchFileSnapshot(
    './__snapshots__/published-budget.txt',
  );
});

it('parses and projects the documents form exactly as before classification', async () => {
  await expect(published(documentsInput, documentsAnswers)).toMatchFileSnapshot(
    './__snapshots__/published-documents.txt',
  );
});

it('shows the respondent of every published form what it shows the applicant', () => {
  for (const input of [exampleInput, budgetInput, documentsInput]) {
    const parsed = parseDefinition(input);
    if (!parsed.success) throw parsed.error;
    for (const field of parsed.data.sections.flatMap((section) => section.fields)) {
      expect(canSee(field, 'respondent'), field.id).toBe(canSee(field, 'applicant'));
    }
  }
});
