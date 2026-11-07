// SPDX-License-Identifier: AGPL-3.0-or-later

import { payloadLeafProblems } from '@pixel-scientists/domain/events';
import { isAuditAction } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { assureAuditActions } from './audit.ts';
import { screeningMatchFound } from './events.ts';

describe('assure audit actions', () => {
  it('are defined, with sensitive reads for officers and matches', () => {
    for (const action of assureAuditActions) expect(isAuditAction(action)).toBe(true);
    expect(assureAuditActions).toEqual(
      expect.arrayContaining([
        'assure.lookup.refreshed',
        'assure.lookup.officers_viewed',
        'assure.screening_run.started',
        'assure.screening_match.viewed',
        'assure.screening_match.decided',
        'assure.duplicate_flag.dismissed',
        'assure.checklist.published',
        'assure.checklist_response.saved',
        'assure.visit.recorded',
        'assure.visit.updated',
      ]),
    );
  });
});

describe('assure.screening_match_found.v1', () => {
  it('carries ids only, readable with the screening read permission', () => {
    expect(screeningMatchFound.read).toBe('assure.screening.read');
    expect(Object.keys(screeningMatchFound.data.shape)).toEqual([
      'matchId',
      'runId',
      'partyId',
      'listId',
    ]);
    expect(payloadLeafProblems(screeningMatchFound.data)).toEqual([]);
  });
});
