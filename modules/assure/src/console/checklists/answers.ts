// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An application's answers as the screen holds them while they are typed:
// one string per item, or the files already linked. Nothing is sent for an
// item left blank.

import type { ChecklistResponse, ChecklistResponseInput } from '../../contracts/index.ts';

export type Held = string | readonly string[];

export type Values = Readonly<Record<string, Held>>;

export function initial({ version, answers }: ChecklistResponse): Values {
  return Object.fromEntries(
    version.items.map(({ id, kind }) => {
      const answer = answers[id];
      if (answer === undefined) return [id, kind === 'file' ? [] : ''];
      return [id, answer.kind === 'file' ? answer.fileIds : answer.value];
    }),
  );
}

export function toBody({ version }: ChecklistResponse, values: Values): ChecklistResponseInput {
  const answers: ChecklistResponseInput['answers'] = {};
  for (const { id, kind } of version.items) {
    const held = values[id];
    if (kind === 'file') {
      if (Array.isArray(held) && held.length > 0) answers[id] = { kind, fileIds: [...held] };
      continue;
    }
    const text = typeof held === 'string' ? held.trim() : '';
    if (text === '') continue;
    if (kind === 'yes_no') {
      if (text === 'yes' || text === 'no' || text === 'not_applicable') {
        answers[id] = { kind, value: text };
      }
    } else if (kind === 'date') {
      answers[id] = { kind, value: text };
    } else {
      answers[id] = { kind, value: text };
    }
  }
  return { versionId: version.id, answers };
}
