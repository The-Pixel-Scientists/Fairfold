// SPDX-License-Identifier: AGPL-3.0-or-later

import { isAuditAction } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { crmAuditActions } from './audit.ts';

describe('crm audit actions', () => {
  it('are defined, with every change and sensitive read the routes need', () => {
    for (const action of crmAuditActions) expect(isAuditAction(action)).toBe(true);
    expect(crmAuditActions).toEqual(
      expect.arrayContaining([
        'crm.party.viewed',
        'crm.interaction.recorded',
        'crm.duplicate.dismissed',
        'crm.merge.previewed',
        'crm.merge.confirmed',
        'crm.merge.reversed',
        'crm.list.created',
        'crm.list.updated',
        'crm.list.archived',
        'crm.list_member.added',
        'crm.list_member.removed',
        'crm.segment.saved',
        'crm.import.started',
        'crm.import.confirmed',
        'crm.external_reference.added',
        'crm.external_reference.removed',
      ]),
    );
  });

  it('leave the merge of the party record itself to party', () => {
    expect(crmAuditActions.some((action) => action.startsWith('crm.party.merge'))).toBe(false);
  });
});
