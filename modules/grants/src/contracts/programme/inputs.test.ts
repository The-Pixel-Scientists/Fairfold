// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue, messages } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  MAX_AMOUNT_MINOR,
  programmeInputSchema,
  roundInputSchema,
  rubricInputSchema,
  stagesInputSchema,
} from './inputs.ts';
import { defaultStageNames } from './lists.ts';
import { programmeMessages } from './messages.ts';

const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const otherId = '6d2e3f4a-5b6c-4d7e-8f90-b1c2d3e4f5a6';

const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' });

const programme = {
  title: 'Community Spaces Fund',
  summary: 'Grants of £1,000 to £25,000 for community spaces.',
};

const round = {
  title: 'Spring 2027',
  opensAt: '2027-02-02T09:00',
  closesAt: '2027-03-03T17:00',
  budget: pounds(250_000),
  awardMinimum: pounds(1_000),
  awardMaximum: pounds(25_000),
  latePolicy: 'refuse',
};

const criterion = { label: 'Need', weight: 3 };

/** Each problem's message, by where it is. */
function problems(schema: z.ZodType, value: unknown): Record<string, string> {
  const result = schema.safeParse(value);
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), messageForIssue(issue)]),
  );
}

describe('programme input', () => {
  it('starts a programme as a draft with no description', () => {
    expect(programmeInputSchema.parse(programme)).toEqual({
      ...programme,
      description: '',
      status: 'draft',
    });
  });

  it('keeps line breaks in the description only', () => {
    const description = 'First paragraph.\r\n\r\nSecond paragraph. ';
    expect(programmeInputSchema.parse({ ...programme, description }).description).toBe(
      'First paragraph.\n\nSecond paragraph.',
    );
    expect(problems(programmeInputSchema, { ...programme, summary: 'Two\nlines' })).toEqual({
      summary: programmeMessages.hiddenCharacters,
    });
    expect(problems(programmeInputSchema, { ...programme, description: 'A\u202eB' })).toEqual({
      description: programmeMessages.hiddenCharactersText,
    });
  });

  it('needs a title, a summary and a known status', () => {
    expect(problems(programmeInputSchema, { ...programme, title: '  ', summary: '' })).toEqual({
      title: programmeMessages.programmeTitle,
      summary: programmeMessages.programmeSummary,
    });
    for (const status of ['draft', 'open', 'closed']) {
      expect(programmeInputSchema.safeParse({ ...programme, status }).success).toBe(true);
    }
    expect(problems(programmeInputSchema, { ...programme, status: 'archived' })).toEqual({
      status: messages.chooseAllowedValue,
    });
  });
});

describe('round input', () => {
  it('takes local dates and times to the minute', () => {
    expect(roundInputSchema.parse(round)).toEqual(round);
    for (const opensAt of [
      '2027-02-02T09:00Z',
      '2027-02-02T09:00:00',
      '2027-02-02T09:00+00:00',
      '2027-02-30T09:00',
      '2027-02-02 09:00',
      '2 February 2027',
    ]) {
      expect(problems(roundInputSchema, { ...round, opensAt }), opensAt).toEqual({
        opensAt: messages.enterValidDate,
      });
    }
  });

  it('closes after it opens', () => {
    for (const closesAt of ['2027-02-02T09:00', '2027-02-01T17:00']) {
      expect(problems(roundInputSchema, { ...round, closesAt }), closesAt).toEqual({
        closesAt: programmeMessages.closesAfterOpens,
      });
    }
    const notADate = { ...round, opensAt: '2027-02-30T09:00', closesAt: '2027-02-10T09:00' };
    expect(problems(roundInputSchema, notADate)).toEqual({ opensAt: messages.enterValidDate });
    const overYearEnd = { ...round, opensAt: '2026-12-31T23:59', closesAt: '2027-01-01T00:00' };
    expect(roundInputSchema.safeParse(overYearEnd).success).toBe(true);
  });

  it('takes amounts of more than £0 and no more than £1,000,000,000, in pounds', () => {
    const largest = { amountMinor: MAX_AMOUNT_MINOR, currency: 'GBP' };
    expect(MAX_AMOUNT_MINOR).toBe(100_000_000_000);
    expect(roundInputSchema.safeParse({ ...round, budget: largest }).success).toBe(true);
    const cases: [unknown, string][] = [
      [{ amountMinor: 0, currency: 'GBP' }, programmeMessages.amountPositive],
      [{ amountMinor: -100, currency: 'GBP' }, programmeMessages.amountPositive],
      [{ amountMinor: MAX_AMOUNT_MINOR + 1, currency: 'GBP' }, programmeMessages.amountTooLarge],
      [{ amountMinor: 1.5, currency: 'GBP' }, messages.enterWholeNumber],
      [{ amountMinor: 100, currency: 'EUR' }, messages.currency],
    ];
    for (const [awardMinimum, message] of cases) {
      expect(problems(roundInputSchema, { ...round, awardMinimum }), message).toEqual({
        [`awardMinimum.${message === messages.currency ? 'currency' : 'amountMinor'}`]: message,
      });
    }
    const extra = { ...round, budget: { ...pounds(250_000), pence: 1 } };
    expect(roundInputSchema.safeParse(extra).success).toBe(false);
  });

  it('keeps the award range inside the budget', () => {
    expect(problems(roundInputSchema, { ...round, awardMaximum: pounds(999) })).toEqual({
      awardMaximum: programmeMessages.awardMaximum,
    });
    expect(problems(roundInputSchema, { ...round, budget: pounds(24_999) })).toEqual({
      budget: programmeMessages.budget,
    });
    const single = { ...round, budget: pounds(5_000), awardMinimum: pounds(5_000) };
    expect(roundInputSchema.safeParse({ ...single, awardMaximum: pounds(5_000) }).success).toBe(
      true,
    );
  });

  it('takes a known late policy', () => {
    for (const latePolicy of ['refuse', 'accept_and_flag']) {
      expect(roundInputSchema.safeParse({ ...round, latePolicy }).success).toBe(true);
    }
    expect(problems(roundInputSchema, { ...round, latePolicy: 'accept' })).toEqual({
      latePolicy: messages.chooseAllowedValue,
    });
  });
});

describe('stages input', () => {
  const stages = (names: readonly string[]) => ({ stages: names.map((name) => ({ name })) });

  it('starts every round with Intake, Review and Decision', () => {
    expect(defaultStageNames).toEqual(['Intake', 'Review', 'Decision']);
    expect(stagesInputSchema.safeParse(stages(defaultStageNames)).success).toBe(true);
  });

  it('keeps stage ids, and needs at least one stage', () => {
    const kept = { stages: [{ id, name: 'Review' }, { name: 'Panel' }] };
    expect(stagesInputSchema.parse(kept)).toEqual(kept);
    expect(stagesInputSchema.safeParse(stages([])).success).toBe(false);
  });

  it('gives each stage a different name, and lists each id once', () => {
    expect(problems(stagesInputSchema, stages(['Intake', 'Review', ' review ']))).toEqual({
      'stages.2.name': programmeMessages.stageNamesUnique,
    });
    expect(problems(stagesInputSchema, stages(['Intake', '']))).toEqual({
      'stages.1.name': programmeMessages.stageName,
    });
    const twice = {
      stages: [
        { id, name: 'Intake' },
        { id, name: 'Review' },
      ],
    };
    expect(problems(stagesInputSchema, twice)).toEqual({
      'stages.1.id': programmeMessages.listedOnce,
    });
  });
});

describe('rubric input', () => {
  it('scores each criterion from 1 to 5 by default', () => {
    expect(rubricInputSchema.parse({ criteria: [criterion] })).toEqual({
      criteria: [{ ...criterion, guidance: '', scaleMin: 1, scaleMax: 5 }],
    });
  });

  it('takes no criteria, for a stage with no rubric', () => {
    expect(rubricInputSchema.safeParse({ criteria: [] }).success).toBe(true);
  });

  it('weights each criterion with a positive whole number', () => {
    for (const weight of [0, -1, 1.5, '3']) {
      const result = rubricInputSchema.safeParse({ criteria: [{ ...criterion, weight }] });
      expect(result.success, String(weight)).toBe(false);
    }
  });

  it('needs a label, and a lowest score below the highest', () => {
    const scales = [
      { label: '', weight: 1 },
      { label: 'Reach', weight: 1, scaleMin: 5, scaleMax: 5 },
      { label: 'Value', weight: 1, scaleMin: 0, scaleMax: 10 },
    ];
    expect(problems(rubricInputSchema, { criteria: scales })).toEqual({
      'criteria.0.label': programmeMessages.criterionLabel,
      'criteria.1.scaleMax': programmeMessages.scale,
    });
  });

  it('keeps criterion ids, listing each once', () => {
    const twice = {
      criteria: [
        { ...criterion, id },
        { ...criterion, id },
      ],
    };
    expect(problems(rubricInputSchema, twice)).toEqual({
      'criteria.1.id': programmeMessages.listedOnce,
    });
    const kept = {
      criteria: [
        { ...criterion, id },
        { ...criterion, id: otherId },
      ],
    };
    expect(rubricInputSchema.safeParse(kept).success).toBe(true);
  });
});

describe('strict inputs', () => {
  it('refuse keys they do not name, such as ids, a tenant or a time zone', () => {
    const inputs: [z.ZodType, object][] = [
      [programmeInputSchema, programme],
      [roundInputSchema, round],
      [stagesInputSchema, { stages: [{ name: 'Intake' }] }],
      [rubricInputSchema, { criteria: [criterion] }],
    ];
    for (const [schema, value] of inputs) {
      expect(schema.safeParse(value).success).toBe(true);
      for (const extra of [{ id }, { tenantId: id }, { timeZone: 'Europe/London' }]) {
        expect(schema.safeParse({ ...value, ...extra }).success).toBe(false);
      }
    }
    const stage = { stages: [{ name: 'Intake', position: 1 }] };
    expect(stagesInputSchema.safeParse(stage).success).toBe(false);
    const extraCriterion = { criteria: [{ ...criterion, stageId: id }] };
    expect(rubricInputSchema.safeParse(extraCriterion).success).toBe(false);
  });
});
