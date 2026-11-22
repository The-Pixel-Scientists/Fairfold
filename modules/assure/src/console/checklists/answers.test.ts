// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { ChecklistResponse } from '../../contracts/index.ts';
import { initial, toBody } from './answers.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const response: ChecklistResponse = {
  checklistId: id(1),
  applicationId: id(2),
  version: {
    id: id(3),
    number: 1,
    name: 'Governance checks',
    description: '',
    publishedAt: '2026-12-01T10:00:00.000Z',
    items: [
      { id: id(10), label: 'Constitution', help: '', kind: 'yes_no', required: true },
      { id: id(11), label: 'Reviewed on', help: '', kind: 'date', required: false },
      { id: id(12), label: 'Notes', help: '', kind: 'short_text', required: false },
      { id: id(13), label: 'Policy', help: '', kind: 'file', required: false },
    ],
  },
  answers: { [id(13)]: { kind: 'file', fileIds: [id(20)] } },
  complete: false,
  savedAt: null,
};

describe('checklist answers', () => {
  it('starts blank, with files already linked kept', () => {
    expect(initial(response)).toEqual({
      [id(10)]: '',
      [id(11)]: '',
      [id(12)]: '',
      [id(13)]: [id(20)],
    });
  });

  it('sends nothing for a blank answer, and no spaces', () => {
    const values = { ...initial(response), [id(10)]: 'yes', [id(12)]: '   ' };
    expect(toBody(response, values)).toEqual({
      versionId: id(3),
      answers: {
        [id(10)]: { kind: 'yes_no', value: 'yes' },
        [id(13)]: { kind: 'file', fileIds: [id(20)] },
      },
    });
  });
});
