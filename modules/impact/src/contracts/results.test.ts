// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { impactMessages } from './messages.ts';
import { learningNoteInputSchema } from './notes.ts';
import { resultInputSchema, resultQuerySchema, resultUpdateSchema } from './results.ts';
import { summaryQuerySchema } from './summary.ts';
import { targetInputSchema, targetUpdateSchema } from './targets.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const OTHER = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f6';

function firstMessage(result: { error?: { issues: object[] } }): string {
  const [issue] = result.error?.issues ?? [];
  return issue === undefined ? 'no problem' : messageForIssue(issue);
}

const period = { periodStart: '2026-04-01', periodEnd: '2027-03-31' };

describe('a target', () => {
  const target = {
    frameworkId: ID,
    indicatorId: OTHER,
    programmeId: null,
    ...period,
    baseline: null,
    target: 120,
  };

  it('is for an indicator over a period, for a programme or overall', () => {
    expect(targetInputSchema.safeParse(target).success).toBe(true);
    expect(targetInputSchema.safeParse({ ...target, programmeId: ID, baseline: 80 }).success).toBe(
      true,
    );
    expect(targetInputSchema.safeParse({ ...target, periodEnd: '2026-04-01' }).success).toBe(true);
    expect(firstMessage(targetInputSchema.safeParse({ ...target, periodEnd: '2026-03-31' }))).toBe(
      impactMessages.periodOrder,
    );
    for (const bad of [
      { ...target, target: null },
      { ...target, target: -5 },
      { ...target, periodStart: '01/04/2026' },
      { ...target, organisationId: ID },
    ]) {
      expect(targetInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('stays with its indicator, programme and period when changed', () => {
    expect(targetUpdateSchema.safeParse(target).success).toBe(false);
    expect(targetUpdateSchema.safeParse({ baseline: 80, target: 150 }).success).toBe(true);
  });
});

describe('a result', () => {
  const result = {
    frameworkId: ID,
    indicatorId: OTHER,
    programmeId: ID,
    ...period,
    value: 96,
    note: 'Counted from the registers.\r\nTwo clubs closed in August.',
    evidence: [{ fileId: ID, caption: 'Attendance summary' }],
  };

  it('records a figure, a note and evidence by file id', () => {
    expect(resultInputSchema.parse(result).note).toBe(
      'Counted from the registers.\nTwo clubs closed in August.',
    );
    expect(resultInputSchema.safeParse({ ...result, note: '', evidence: [] }).success).toBe(true);
    expect(firstMessage(resultInputSchema.safeParse({ ...result, periodEnd: '2026-01-01' }))).toBe(
      impactMessages.periodOrder,
    );
    expect(
      firstMessage(
        resultInputSchema.safeParse({ ...result, evidence: [{ fileId: ID, caption: ' ' }] }),
      ),
    ).toBe(impactMessages.caption);
    expect(
      firstMessage(
        resultInputSchema.safeParse({
          ...result,
          evidence: [result.evidence[0], result.evidence[0]],
        }),
      ),
    ).toBe(impactMessages.listedOnce);
    expect(firstMessage(resultInputSchema.safeParse({ ...result, value: 9.999 }))).toBe(
      impactMessages.decimalPlaces,
    );
  });

  it('names no person, party or source, and takes no link as evidence', () => {
    for (const bad of [
      { ...result, personId: ID },
      { ...result, partyId: ID },
      { ...result, source: 'monitoring_report' },
      { ...result, evidence: [{ fileId: ID, caption: 'Report', url: 'https://example.org' }] },
      { ...result, evidence: Array.from({ length: 21 }, () => result.evidence[0]) },
    ]) {
      expect(resultInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('stays with its indicator, programme and period when corrected', () => {
    expect(resultUpdateSchema.safeParse(result).success).toBe(false);
    const { value, note, evidence } = result;
    expect(resultUpdateSchema.safeParse({ value, note, evidence }).success).toBe(true);
  });

  it('is listed for one framework, by indicator or programme', () => {
    expect(resultQuerySchema.safeParse({ frameworkId: ID }).success).toBe(true);
    expect(
      resultQuerySchema.safeParse({ frameworkId: ID, indicatorId: OTHER, cursor: 'abc_-9' })
        .success,
    ).toBe(true);
    expect(resultQuerySchema.safeParse({}).success).toBe(false);
    expect(resultQuerySchema.safeParse({ frameworkId: ID, cursor: 'a b' }).success).toBe(false);
  });
});

describe('a learning note', () => {
  it('has text, for a framework or one of its outcomes', () => {
    const note = { frameworkId: ID, outcomeId: null, text: 'Lunch clubs need transport.' };
    expect(learningNoteInputSchema.safeParse(note).success).toBe(true);
    expect(learningNoteInputSchema.safeParse({ ...note, outcomeId: OTHER }).success).toBe(true);
    expect(firstMessage(learningNoteInputSchema.safeParse({ ...note, text: ' \n ' }))).toBe(
      impactMessages.note,
    );
    expect(learningNoteInputSchema.safeParse({ ...note, author: 'Alex Example' }).success).toBe(
      false,
    );
  });
});

describe('a summary', () => {
  it('takes a programme and dates in order, all optional', () => {
    expect(summaryQuerySchema.safeParse({}).success).toBe(true);
    expect(
      summaryQuerySchema.safeParse({ programmeId: ID, from: '2026-04-01', to: '2027-03-31' })
        .success,
    ).toBe(true);
    expect(
      firstMessage(summaryQuerySchema.safeParse({ from: '2027-04-01', to: '2026-03-31' })),
    ).toBe(impactMessages.periodOrder);
  });
});
