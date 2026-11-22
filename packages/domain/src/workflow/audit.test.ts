// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { isAuditAction, platformAuditActions } from '../platform/audit.ts';
import { workflowAuditActions } from './audit.ts';

describe('approval audit actions', () => {
  it('record each request, decision, withdrawal and sensitive read', () => {
    expect(workflowAuditActions).toEqual([
      'platform.approval.requested',
      'platform.approval.approved',
      'platform.approval.rejected',
      'platform.approval.withdrawn',
      'platform.approval.viewed',
    ]);
    for (const action of workflowAuditActions) expect(isAuditAction(action)).toBe(true);
  });

  it('are not in the platform list, so no code is defined twice', () => {
    for (const action of workflowAuditActions) {
      expect(platformAuditActions as readonly string[]).not.toContain(action);
    }
  });
});
