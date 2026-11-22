// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  annualReturnOutput,
  Failure,
  parseFigures,
  sorpNoteOutput,
  threeSixtyGivingOutput,
} from './builders.ts';
import type { CommittedFigure } from './sources.ts';

const period = { start: '2026-04-01', end: '2027-03-31' };
const programme = (n: number) => ({
  programmeId: `00000000-0000-4000-8000-00000000000${String(n)}`,
  programmeTitle: `Programme ${String(n)}`,
});
const figure = (change: Partial<CommittedFigure>): CommittedFigure => ({
  ...programme(1),
  recipient: 'institution',
  currency: 'GBP',
  count: 2,
  amountMinor: 250_000,
  ...change,
});

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('parseFigures', () => {
  it('takes figures and nothing that names anyone', () => {
    expect(parseFigures([figure({})])).toHaveLength(1);
    for (const extra of [{ name: 'Sam Rivers' }, { email: 'sam@example.test' }, { count: 0 }]) {
      expect(() => parseFigures([{ ...figure({}), ...extra }])).toThrow(Failure);
    }
  });

  it('refuses a currency we do not know, a fraction and a sum past exact', () => {
    expect(() => parseFigures([{ ...figure({}), currency: 'XXX' }])).toThrow(Failure);
    expect(() => parseFigures([figure({ amountMinor: 1.5 })])).toThrow(Failure);
    const big = figure({ amountMinor: Number.MAX_SAFE_INTEGER });
    expect(() => parseFigures([big, big])).toThrow(Failure);
  });
});

describe('the grant-making note', () => {
  const rows = [
    figure({ count: 2, amountMinor: 250_000 }),
    figure({ ...programme(2), count: 1, amountMinor: 100_000 }),
    figure({ recipient: 'individual', count: 1, amountMinor: 50_000 }),
  ];
  const note = text(sorpNoteOutput(rows, period).bytes);

  it('says plainly that it is a draft, and what the figures are', () => {
    expect(note).toContain('draft for the trustees and accountants to check');
    expect(note).toContain('not payments made');
    expect(note).toContain('1 April 2026 to 31 March 2027');
  });

  it('shows institutions by programme and individuals only as one total', () => {
    expect(note).toContain('Grants to institutions: 3 grants, £3,500');
    expect(note).toContain('Programme 1: 2 grants, £2,500');
    expect(note).toContain('Programme 2: 1 grant, £1,000');
    expect(note).toContain('Grants to individuals: 1 grant, £500. Individuals are not named');
    expect(note).toContain('Grants committed in GBP: 4 grants, £4,000');
  });

  it('shows no individual under a programme, even when one programme has only one', () => {
    const lone = text(
      sorpNoteOutput([figure({ ...programme(9), recipient: 'individual', count: 1 })], period)
        .bytes,
    );
    expect(lone).not.toContain('Programme 9');
  });

  it('says so when nothing was committed', () => {
    expect(text(sorpNoteOutput([], period).bytes)).toContain('No grants were committed');
  });
});

describe('the annual return figures', () => {
  const document = JSON.parse(
    text(
      annualReturnOutput([figure({}), figure({ recipient: 'individual', count: 1 })], period).bytes,
    ),
  ) as {
    draft: boolean;
    figures: { id: string; value: number; definition: string; period: unknown }[];
  };

  it('is a draft, and each figure states its definition and period', () => {
    expect(document.draft).toBe(true);
    expect(document.figures.length).toBeGreaterThan(0);
    for (const row of document.figures) {
      expect(row.definition.length).toBeGreaterThan(10);
      expect(row.period).toEqual(period);
    }
  });

  it('counts and totals each group', () => {
    const value = (id: string) => document.figures.find((row) => row.id === id)?.value;
    expect(value('grants_all_count')).toBe(3);
    expect(value('grants_institution_total')).toBe(250_000);
    expect(value('grants_individual_count')).toBe(1);
  });
});

describe('sums', () => {
  it('is summed in minor units for each currency', () => {
    // The domain lists one currency for now, so this checks that
    // programmes add up whole, in the currency's minor units.
    const rows = [figure({ amountMinor: 1 }), figure({ ...programme(2), amountMinor: 2 })];
    const document = JSON.parse(text(annualReturnOutput(rows, period).bytes)) as {
      figures: { id: string; currency: string; value: number }[];
    };
    const totals = document.figures.filter(({ id }) => id === 'grants_all_total');
    expect(totals).toEqual([expect.objectContaining({ currency: 'GBP', value: 3 })]);
  });
});

describe('the 360Giving file', () => {
  const built = { grants: [{}, {}] };

  it('is the file grants built, unchanged', () => {
    const output = threeSixtyGivingOutput({
      status: 'built',
      file: built,
      summary: { grants: 2, unverifiedRecipients: [] },
    });
    expect(JSON.parse(text(output.bytes))).toEqual(built);
  });

  it('is refused when its count does not match, or when grants is off', () => {
    expect(() =>
      threeSixtyGivingOutput({
        status: 'built',
        file: built,
        summary: { grants: 3, unverifiedRecipients: [] },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_export' }));
    expect(() => threeSixtyGivingOutput({ status: 'grants_off' })).toThrow(
      expect.objectContaining({ code: 'grants_off' }),
    );
  });
});

describe('this folder', () => {
  const files = readdirSync(import.meta.dirname)
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .map((name) => ({ name, text: readFileSync(join(import.meta.dirname, name), 'utf8') }));

  it('makes no request, sends no email, schedules nothing and reads no other module’s tables', () => {
    expect(files.length).toBeGreaterThan(0);
    const found = files.filter(({ text: source }) =>
      /fetch\(|undici|node:https?|from 'https?'|nodemailer|schedule|sendEmail|generated\/(grants|party)|@pixel-scientists\/(grants|party)/.test(
        source,
      ),
    );
    expect(found.map(({ name }) => name)).toEqual([]);
  });
});
