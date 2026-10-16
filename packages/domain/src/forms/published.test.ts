// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Published versions are immutable, so a new field type must leave every
// earlier version parsing and projecting exactly as it did. The example
// form's snapshot was written by the engine before the table question
// existed, and the budget form's before the file question.

import { expect, it } from 'vitest';

import { projectionAudiences } from './audience.ts';
import { budgetAnswers, budgetInput, exampleAnswers, exampleInput } from './fixture.ts';
import { projectAnswers } from './project.ts';
import { parseDefinition } from './rules.ts';

function published(input: unknown, answers: Record<string, unknown>): string {
  const parsed = parseDefinition(input);
  if (!parsed.success) throw parsed.error;
  const projections = Object.fromEntries(
    projectionAudiences.map((audience) => [
      audience,
      projectAnswers(parsed.data, answers, audience),
    ]),
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
