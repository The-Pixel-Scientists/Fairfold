// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { checklistInputSchema, checklistResponseInputSchema } from './checklists.ts';
import { assureMessages } from './messages.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const OTHER = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f6';

const item = { id: ID, label: 'Governing document seen', kind: 'yes_no', required: true };

function firstMessage(result: { error?: { issues: object[] } }): string {
  const [issue] = result.error?.issues ?? [];
  return issue === undefined ? 'no problem' : messageForIssue(issue);
}

describe('checklists', () => {
  it('take items with stable ids, each once', () => {
    expect(checklistInputSchema.parse({ name: 'Standard checks', items: [item] })).toEqual({
      name: 'Standard checks',
      description: '',
      items: [{ ...item, help: '' }],
    });
    expect(
      firstMessage(checklistInputSchema.safeParse({ name: 'Checks', items: [item, item] })),
    ).toBe(assureMessages.listedOnce);
    expect(
      firstMessage(
        checklistInputSchema.safeParse({ name: 'Checks', items: [{ ...item, kind: 'number' }] }),
      ),
    ).toBe(assureMessages.answerKind);
  });

  it('record their changes as the assure.checklist config diff allows', () => {
    expect(
      configDiffSchemas['assure.checklist'].safeParse([
        { path: `items.${ID}.label`, from: 'Old', to: 'New' },
        { path: `items.${ID}.kind`, from: 'yes_no', to: 'date' },
      ]).success,
    ).toBe(true);
  });

  it('take answers keyed by item id, of the kind asked, with files by id only', () => {
    const answers = {
      [ID]: { kind: 'yes_no', value: 'not_applicable' },
      [OTHER]: { kind: 'file', fileIds: [ID] },
    };
    expect(checklistResponseInputSchema.parse({ versionId: ID, answers }).answers).toEqual(answers);
    for (const bad of [
      { versionId: ID, answers: { q1: { kind: 'date', value: '2026-11-11' } } },
      { versionId: ID, answers: { [ID]: { kind: 'file', fileIds: [], name: 'a.pdf' } } },
      { versionId: ID, answers: { [ID]: { kind: 'file', fileIds: [ID, ID] } } },
      { answers: {} },
    ]) {
      expect(checklistResponseInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(
      firstMessage(
        checklistResponseInputSchema.safeParse({
          versionId: ID,
          answers: { [ID]: { kind: 'yes_no', value: 'maybe' } },
        }),
      ),
    ).toBe(assureMessages.yesNo);
  });
});
