// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants: equality monitoring answers (ADR 0032), special category data even
// though synthetic. They go into grants.monitoring_response only, under
// consent, against the round's monitoring form, and are never printed,
// logged or copied. No table yet says which form version a round uses for
// monitoring, so each round's form is published as its version 2, after
// the application form its applications pinned.
//
// The counts are designed against the platform floor (a threshold of 10
// and a minimum group of 20, modules/insight/src/contracts/disclosure.ts),
// so a report that forgot to suppress would re-identify someone:
//
//   Spring 2026, 57 responses from 62 applications (5 skipped the step)
//     age: 0, 1, 9, 10 and 11, with 12 aged 65 or over and 14 preferring
//       not to say
//     ethnic group: one cell under the threshold (3 mixed), so secondary
//       suppression must hide a second
//     sex: 14 of 57 prefer not to say
//   Summer 2026, 8 responses from 10 applications (2 skipped): every cell
//     under the threshold and the round under the minimum group
//
// Responses are dealt in order, each taking the next answer of every
// question, and each question lists "Prefer not to say" first, so the
// first responses answer it to everything: 12 in spring and 2 in summer.

import { parseDefinition, validateAnswers } from '@pixel-scientists/domain/forms';

import type { Part, PartWriter } from '../write.ts';

const PREFER_NOT_TO_SAY = 'prefer_not_to_say';
export const PRIVACY_NOTICE_VERSION = 'monitoring-2026-1';

type Choice = readonly [value: string, label: string];

/** A question from grants' monitoring question set, as modules/grants/src/contracts/monitoring/questions.ts words it. */
const question = (id: string, label: string, choices: readonly Choice[]) => ({
  id,
  type: 'single_choice',
  label,
  required: false,
  identity: false,
  audiences: 'aggregate_only',
  classification: 'special_category',
  conditions: [],
  options: [
    ...choices.map(([value, text]) => ({ value, label: text })),
    { value: PREFER_NOT_TO_SAY, label: 'Prefer not to say' },
  ],
});

/** Three of the question set, in the order the funder chose. */
export const monitoringForm = {
  sections: [
    {
      id: 's_monitoring',
      title: 'Equality monitoring',
      conditions: [],
      fields: [
        question('f_agegroup', 'What is your age?', [
          ['under_25', 'Under 25'],
          ['25_34', '25 to 34'],
          ['35_44', '35 to 44'],
          ['45_54', '45 to 54'],
          ['55_64', '55 to 64'],
          ['65_over', '65 or over'],
        ]),
        question('f_ethnicgroup', 'What is your ethnic group?', [
          ['asian', 'Asian or Asian British'],
          ['black', 'Black, Black British, Caribbean or African'],
          ['mixed', 'Mixed or multiple ethnic groups'],
          ['white', 'White'],
          ['other', 'Another ethnic group'],
        ]),
        question('f_sex', 'What is your sex?', [
          ['female', 'Female'],
          ['male', 'Male'],
        ]),
      ],
    },
  ],
};

type Cells = Readonly<Record<string, readonly (readonly [option: string, count: number])[]>>;

/** Each round's designed counts by question and option, and how many applications skipped the step. */
export const designedCells: Readonly<
  Record<string, { readonly skipped: number; readonly cells: Cells }>
> = {
  'Spring 2026': {
    skipped: 5,
    cells: {
      f_agegroup: [
        [PREFER_NOT_TO_SAY, 14],
        ['under_25', 0],
        ['25_34', 1],
        ['35_44', 9],
        ['45_54', 10],
        ['55_64', 11],
        ['65_over', 12],
      ],
      f_ethnicgroup: [
        [PREFER_NOT_TO_SAY, 12],
        ['asian', 10],
        ['black', 10],
        ['mixed', 3],
        ['white', 12],
        ['other', 10],
      ],
      f_sex: [
        [PREFER_NOT_TO_SAY, 14],
        ['female', 24],
        ['male', 19],
      ],
    },
  },
  'Summer 2026': {
    skipped: 2,
    cells: {
      f_agegroup: [
        [PREFER_NOT_TO_SAY, 2],
        ['under_25', 1],
        ['25_34', 2],
        ['35_44', 1],
        ['45_54', 0],
        ['55_64', 2],
        ['65_over', 0],
      ],
      f_ethnicgroup: [
        [PREFER_NOT_TO_SAY, 2],
        ['asian', 2],
        ['black', 1],
        ['mixed', 1],
        ['white', 2],
        ['other', 0],
      ],
      f_sex: [
        [PREFER_NOT_TO_SAY, 2],
        ['female', 3],
        ['male', 3],
      ],
    },
  },
};

/** The answers that produce `cells`, one object per response. */
export function responsesFor(cells: Cells): Record<string, string>[] {
  const dealt = Object.entries(cells).map(
    ([fieldId, counts]) =>
      [fieldId, counts.flatMap(([option, count]) => Array<string>(count).fill(option))] as const,
  );
  const sizes = new Set(dealt.map(([, answers]) => answers.length));
  const [size] = sizes;
  if (size === undefined || sizes.size !== 1) {
    throw new Error('Every monitoring question needs the same number of answers.');
  }
  return Array.from({ length: size }, (_, n) =>
    Object.fromEntries(dealt.map(([fieldId, answers]) => [fieldId, answers[n] ?? ''])),
  );
}

async function write(writer: PartWriter): Promise<void> {
  const { client, insert, tenant, tenantId, written } = writer;
  const parsed = parseDefinition(monitoringForm);
  if (!parsed.success) throw new Error('The monitoring form is not a valid form.');
  const rounds = (tenant.programmes ?? []).flatMap((programme) => programme.rounds);
  let first = 0;
  for (const [index, round] of rounds.entries()) {
    const count = round.applications?.length ?? 0;
    const applications = (written['grants.application'] ?? []).slice(first, first + count);
    first += count;
    const design = designedCells[round.title];
    if (design === undefined) continue;
    const responses = responsesFor(design.cells);
    if (responses.length + design.skipped !== applications.length) {
      throw new Error(`${round.title} needs one application for each response and each skip.`);
    }
    const roundId = written['grants.round']?.[index];
    const { rows } = await client.query<{ published_at: Date }>(
      'SELECT published_at FROM grants.form_version WHERE round_id = $1 AND version = 1',
      [roundId],
    );
    const formVersionId = await insert('grants.form_version', {
      tenant_id: tenantId,
      round_id: roundId,
      version: 2,
      status: 'published',
      definition: parsed.data,
      published_at: rows[0]?.published_at,
      published_by: writer.member('programme_manager'),
    });
    for (const [n, answers] of responses.entries()) {
      if (validateAnswers(parsed.data, answers, 'submit').length > 0) {
        throw new Error(`A designed monitoring response for ${round.title} is not valid.`);
      }
      await insert('grants.monitoring_response', {
        tenant_id: tenantId,
        round_id: roundId,
        application_id: applications[n],
        form_version_id: formVersionId,
        answers,
        privacy_notice_version: PRIVACY_NOTICE_VERSION,
      });
    }
  }
}

export const part: Part = { tool: 'grants', write };
