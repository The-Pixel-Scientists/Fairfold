// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { assureMessages } from './messages.ts';
import { visitInputSchema, visitUpdateSchema } from './visits.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const OTHER = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f6';

function firstMessage(result: { error?: { issues: object[] } }): string {
  const [issue] = result.error?.issues ?? [];
  return issue === undefined ? 'no problem' : messageForIssue(issue);
}

describe('visits', () => {
  const visit = {
    organisationId: ID,
    applicationId: null,
    visitedOn: '2026-11-10',
    type: 'in_person',
    attendeePersonIds: [OTHER],
    findings: 'Saw the new hall.\r\nAll as described.',
    followUps: [{ action: 'Send the updated budget', dueOn: null, done: false }],
    evidence: [{ fileId: ID, caption: 'The hall' }],
  };

  it('record attendees and evidence by id', () => {
    expect(visitInputSchema.parse(visit).findings).toBe('Saw the new hall.\nAll as described.');
    for (const bad of [
      { ...visit, attendeePersonIds: [OTHER, OTHER] },
      { ...visit, attendeePersonIds: ['Alex Example'] },
      { ...visit, evidence: [{ fileId: ID, caption: ' ' }] },
      { ...visit, evidence: [{ fileId: ID, caption: 'Hall', url: 'https://example.org' }] },
    ]) {
      expect(visitInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(firstMessage(visitInputSchema.safeParse({ ...visit, type: 'drive_by' }))).toBe(
      assureMessages.visitType,
    );
  });

  it('stay with their organisation when changed', () => {
    expect(visitUpdateSchema.safeParse(visit).success).toBe(false);
    const { visitedOn, type, attendeePersonIds, findings, followUps, evidence } = visit;
    const update = { visitedOn, type, attendeePersonIds, findings, followUps, evidence };
    expect(visitUpdateSchema.safeParse(update).success).toBe(true);
  });
});
