// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { targetOf } from './target.ts';

const at = (round: string, stage: string) => ({
  round: { id: round },
  stage: { id: stage, name: `Stage ${stage}` },
});

describe('the stage submissions are assigned at', () => {
  it('is the stage they are all in', () => {
    expect(targetOf([at('r1', 's1'), at('r1', 's1')])).toEqual({
      roundId: 'r1',
      stageId: 's1',
      stageName: 'Stage s1',
    });
  });

  it('is none when they are in different stages or rounds, or there are none', () => {
    expect(targetOf([at('r1', 's1'), at('r1', 's2')])).toBeNull();
    expect(targetOf([at('r1', 's1'), at('r2', 's1')])).toBeNull();
    expect(targetOf([])).toBeNull();
  });
});
