// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { mayMove, stageFlow } from './stage-workflow.ts';

const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const [intake, review, decision] = ids as [string, string, string];
const stages = [
  { id: intake, name: 'Intake' },
  { id: review, name: 'Review' },
  { id: decision, name: 'Decision' },
];
const triager = {
  id: 'a1111111-1111-4111-8111-111111111111',
  permissions: new Set(['grants.applications.triage' as const]),
};
const reviewer = { id: triager.id, permissions: new Set<never>() };

describe('the stage workflow', () => {
  it('starts in the first stage and has no approval step', () => {
    const flow = stageFlow(stages);
    expect(flow?.initial).toBe(intake);
    expect(flow?.states.map(({ id }) => id)).toEqual(ids);
    expect(flow?.approvalSteps).toEqual([]);
  });

  it('has none for a round without stages', () => {
    expect(stageFlow([])).toBeUndefined();
  });

  it('lets a member who triages move between any two different stages', () => {
    const flow = stageFlow(stages);
    if (flow === undefined) throw new Error('No workflow.');
    for (const from of ids) {
      for (const to of ids) expect(mayMove(flow, from, to, triager)).toBe(from !== to);
    }
  });

  it('refuses a member who may not triage, and a stage of another round', () => {
    const flow = stageFlow(stages);
    if (flow === undefined) throw new Error('No workflow.');
    expect(mayMove(flow, intake, review, reviewer)).toBe(false);
    expect(mayMove(flow, intake, '00000000-0000-4000-8000-0000000000ff', triager)).toBe(false);
  });

  it('holds one stage with no way to move', () => {
    expect(stageFlow([{ id: intake, name: 'Intake' }])?.transitions).toEqual([]);
  });
});
