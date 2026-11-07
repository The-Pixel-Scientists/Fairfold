// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { assureMessages } from './messages.ts';
import {
  decideScreeningMatch,
  matchDecisionInputSchema,
  matchQuerySchema,
  matchReasonCodes,
  matchReasons,
  matchSchema,
} from './matches.ts';
import { getScreeningRun, screeningRunSchema } from './screening.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

/** The words a person sees for the first problem with `input`. */
function messageFor(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected a problem');
  const [issue] = result.error.issues;
  return issue === undefined ? 'no problem' : messageForIssue(issue);
}

describe('a match decision', () => {
  it('is an outcome and a reason that fits it', () => {
    for (const [outcome, reasons] of Object.entries(matchReasons)) {
      for (const reason of reasons) {
        expect(matchDecisionInputSchema.parse({ outcome, reason })).toEqual({ outcome, reason });
      }
    }
    expect(matchReasonCodes).toHaveLength(8);
  });

  it('refuses a reason for another outcome, a note, a member and a missing outcome', () => {
    expect(
      messageFor(matchDecisionInputSchema, { outcome: 'confirmed', reason: 'different_name' }),
    ).toBe(assureMessages.reasonForOutcome);
    for (const bad of [
      { outcome: 'not_a_match', reason: 'different_name', note: 'Checked' },
      { outcome: 'not_a_match', reason: 'different_name', decidedBy: ID },
      { reason: 'identity_confirmed' },
      { outcome: 'confirmed' },
    ]) {
      expect(matchDecisionInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('says how to fix an unknown outcome or reason', () => {
    expect(messageFor(matchDecisionInputSchema, { outcome: 'auto', reason: 'x' })).toBe(
      assureMessages.matchOutcome,
    );
    expect(
      messageFor(matchDecisionInputSchema, { outcome: 'not_a_match', reason: 'looks_fine' }),
    ).toBe(assureMessages.matchReason);
    expect(messageFor(matchQuerySchema, { status: 'closed' })).toBe(assureMessages.matchStatus);
  });

  it('has no default, and lists its values for the API document', () => {
    const schema = JSON.stringify(z.toJSONSchema(decideScreeningMatch.body, { io: 'input' }));
    expect(schema).not.toContain('"default"');
    expect(schema).toContain('"enum":["not_a_match","needs_information","confirmed"]');
  });
});

describe('reading a match', () => {
  it('holds the listed entry beside the name screened, and no statement of reasons', () => {
    expect(Object.keys(matchSchema.shape.entry.shape)).toEqual([
      'designationId',
      'name',
      'regime',
      'designatedOn',
      'datesOfBirth',
      'nationalities',
      'country',
    ]);
    expect(matchSchema.shape).toHaveProperty('screenedName');
  });
});

describe('a screening run', () => {
  it('names the list version it used, and has a status for a stale or missing list', () => {
    expect(Object.keys(screeningRunSchema.shape.list.unwrap().shape)).toEqual([
      'id',
      'publishedOn',
      'downloadedAt',
      'lastCheckedAt',
    ]);
    expect(screeningRunSchema.shape.status.options).toEqual(
      expect.arrayContaining(['stale_list', 'no_list']),
    );
    expect(getScreeningRun.responses[200]).toBe(screeningRunSchema);
  });
});
