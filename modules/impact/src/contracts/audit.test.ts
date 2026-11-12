// SPDX-License-Identifier: AGPL-3.0-or-later

import { isAuditAction } from '@pixel-scientists/domain/platform';
import { expect, it } from 'vitest';

import { impactAuditActions } from './audit.ts';

it('defines impact’s audit actions, every one impact.*', () => {
  expect(impactAuditActions).toEqual([
    'impact.framework.created',
    'impact.framework.changed',
    'impact.framework.archived',
    'impact.target.set',
    'impact.target.changed',
    'impact.target.removed',
    'impact.result.recorded',
    'impact.result.corrected',
    'impact.result.removed',
    'impact.learning_note.added',
    'impact.learning_note.removed',
  ]);
  for (const action of impactAuditActions) expect(isAuditAction(action)).toBe(true);
});
