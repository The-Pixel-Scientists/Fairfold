// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Published versions are immutable, so a new field type must leave every
// earlier version parsing and projecting exactly as it did. The snapshot was
// written by the engine before the table question existed.

import { expect, it } from 'vitest';

import { projectionAudiences } from './audience.ts';
import { exampleAnswers, exampleInput } from './fixture.ts';
import { projectAnswers } from './project.ts';
import { parseDefinition } from './rules.ts';

it('parses and projects the example form exactly as before the table question', async () => {
  const parsed = parseDefinition(exampleInput);
  if (!parsed.success) throw parsed.error;
  const projections = Object.fromEntries(
    projectionAudiences.map((audience) => [
      audience,
      projectAnswers(parsed.data, exampleAnswers, audience),
    ]),
  );
  const text = JSON.stringify({ definition: parsed.data, projections }, null, 2);
  await expect(`${text}\n`).toMatchFileSnapshot('./__snapshots__/published.txt');
});
