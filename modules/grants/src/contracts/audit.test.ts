// SPDX-License-Identifier: AGPL-3.0-or-later

import { auditEntityType, isAuditAction } from '@pixel-scientists/domain/platform';
import { auditActionLabel } from '@pixel-scientists/domain/platform/audit-log';
import { describe, expect, it } from 'vitest';

import { grantsAuditActions } from './audit.ts';

describe('grants audit actions', () => {
  it('are defined for the audit writer', () => {
    for (const action of grantsAuditActions) expect(isAuditAction(action), action).toBe(true);
    expect(new Set(grantsAuditActions.map(auditEntityType))).toEqual(
      new Set([
        'grants.programme',
        'grants.round',
        'grants.stage',
        'grants.form_version',
        'grants.application',
        'grants.reviewer',
        'grants.assignment',
        'grants.review',
        'grants.decision',
        'grants.decision_email',
        'grants.export',
        'grants.publisher_setting',
      ]),
    );
  });

  it('read as plain words in the audit log', () => {
    expect(grantsAuditActions.map(auditActionLabel)).toEqual([
      'Programme created',
      'Programme updated',
      'Programme email templates changed',
      'Round created',
      'Round updated',
      'Round stages changed',
      'Stage rubric changed',
      'Form version created',
      'Form version updated',
      'Form version published',
      'Form version discarded',
      'Application created',
      'Application eligibility checked',
      'Application submitted',
      'Application withdrawn',
      'Application stage changed',
      'Application viewed',
      'Reviewer added',
      'Reviewer removed',
      'Assignment created',
      'Assignment removed',
      'Assignment conflict declared',
      'Review submitted',
      'Decision recorded',
      'Decision changed',
      'Decision released',
      'Decision email sent',
      'Decision email failed',
      'Decision email resent',
      'Export downloaded',
      'Publisher setting changed',
    ]);
  });
});
