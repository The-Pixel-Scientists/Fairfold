// SPDX-License-Identifier: AGPL-3.0-or-later

import { isAuditAction } from '@pixel-scientists/domain/platform';
import { expect, it } from 'vitest';

import { insightAuditActions } from './audit.ts';

it('defines insight’s audit actions, every one insight.*', () => {
  expect(insightAuditActions).toEqual([
    'insight.report_definition.created',
    'insight.report_definition.changed',
    'insight.report_definition.archived',
    'insight.report.run',
    'insight.monitoring_report.run',
    'insight.monitoring_report.refused',
    'insight.publication_run.prepared',
    'insight.publication_run.submitted',
    'insight.disclosure_rule.changed',
  ]);
  for (const action of insightAuditActions) expect(isAuditAction(action)).toBe(true);
});
