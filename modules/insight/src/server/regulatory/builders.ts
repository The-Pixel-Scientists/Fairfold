// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The three outputs, built from what grants answered. Each is a draft for a
// named person to check and submit themselves; this code sends nothing. Money
// is summed in minor units for each currency and never across currencies.
// Grants to individuals appear only as totals, never named and never split by
// programme, so that a programme with one such grant shows no one. No output
// holds a name, contact detail or monitoring answer: the figures carry none.

import { formatMoney, type Currency } from '@pixel-scientists/domain/platform';

import {
  isCommittedFigure,
  type CommittedFigure,
  type Period,
  type ThreeSixtyGivingBuild,
} from './sources.ts';

/** Why a run failed, as the code its row keeps. No message is ever stored. */
export type FailureCode =
  | 'module_off'
  | 'not_allowed'
  | 'grants_off'
  | 'invalid_figures'
  | 'invalid_export'
  | 'output_failed';

export class Failure extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode) {
    super(`The run failed: ${code}.`);
    this.code = code;
  }
}

/** A finished output, ready to store. */
export interface Output {
  readonly name: string;
  readonly contentType: 'application/json' | 'text/plain';
  readonly bytes: Uint8Array;
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const day = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const words = (period: Period): string => `${day(period.start)} to ${day(period.end)}`;

const NOTICE =
  'This is a draft, prepared for a named person to check and submit themselves. ' +
  'Nothing has been sent to anyone. The figures are grants committed, not payments made.';

/** Checks what grants answered, and refuses a row that is not a figure or a sum that is not exact. */
export function parseFigures(rows: readonly unknown[]): CommittedFigure[] {
  const figures = rows.filter(isCommittedFigure);
  if (figures.length !== rows.length) throw new Failure('invalid_figures');
  const sum = figures.reduce((total, { amountMinor }) => total + amountMinor, 0);
  if (!Number.isSafeInteger(sum)) throw new Failure('invalid_figures');
  return figures;
}

interface Totals {
  count: number;
  minor: number;
}

const add = (totals: Totals, figure: CommittedFigure): void => {
  totals.count += figure.count;
  totals.minor += figure.amountMinor;
};

interface ProgrammeTotals extends Totals {
  readonly title: string;
}

interface CurrencyTotals {
  readonly all: Totals;
  readonly institution: Totals;
  readonly individual: Totals;
  /** Institutions only: the programme's id, title and totals. */
  readonly programmes: Map<string, ProgrammeTotals>;
}

function byCurrency(figures: readonly CommittedFigure[]): [Currency, CurrencyTotals][] {
  const sums = new Map<Currency, CurrencyTotals>();
  for (const figure of figures) {
    const held: CurrencyTotals = sums.get(figure.currency) ?? {
      all: { count: 0, minor: 0 },
      institution: { count: 0, minor: 0 },
      individual: { count: 0, minor: 0 },
      programmes: new Map<string, ProgrammeTotals>(),
    };
    sums.set(figure.currency, held);
    add(held.all, figure);
    add(held[figure.recipient], figure);
    if (figure.recipient === 'institution') {
      const programme: ProgrammeTotals = held.programmes.get(figure.programmeId) ?? {
        title: figure.programmeTitle,
        count: 0,
        minor: 0,
      };
      add(programme, figure);
      held.programmes.set(figure.programmeId, programme);
    }
  }
  return [...sums].sort(([a], [b]) => a.localeCompare(b));
}

const grantsIn = (count: number): string =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? 'grant' : 'grants'}`;

/** Grants' file as 360Giving publishes it, checked once more for the count it claims. */
export function threeSixtyGivingOutput(build: ThreeSixtyGivingBuild): Output {
  if (build.status === 'grants_off') throw new Failure('grants_off');
  const { grants: published } = build.file;
  if (published.length !== build.summary.grants) throw new Failure('invalid_export');
  return {
    name: '360giving-grants.json',
    contentType: 'application/json',
    bytes: encode(JSON.stringify(build.file)),
  };
}

/** The draft grant-making note: committed totals and counts, institutions apart from individuals. */
export function sorpNoteOutput(figures: readonly CommittedFigure[], period: Period): Output {
  const lines = [
    'Grant-making note: draft for the trustees and accountants to check',
    '',
    NOTICE,
    `Period: ${words(period)}, for awards accepted and released in those days.`,
  ];
  if (figures.length === 0) lines.push('', 'No grants were committed in this period.');
  for (const [currency, held] of byCurrency(figures)) {
    const money = (totals: Totals) => formatMoney({ amountMinor: totals.minor, currency });
    lines.push(
      '',
      `Grants committed in ${currency}: ${grantsIn(held.all.count)}, ${money(held.all)}`,
      `Grants to institutions: ${grantsIn(held.institution.count)}, ${money(held.institution)}`,
    );
    for (const { title, count, minor } of [...held.programmes.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    )) {
      lines.push(
        `  ${title}: ${grantsIn(count)}, ${formatMoney({ amountMinor: minor, currency })}`,
      );
    }
    lines.push(
      `Grants to individuals: ${grantsIn(held.individual.count)}, ${money(held.individual)}. ` +
        'Individuals are not named or split by programme.',
    );
  }
  return {
    name: 'grant-making-note-draft.txt',
    contentType: 'text/plain',
    bytes: encode(`${lines.join('\n')}\n`),
  };
}

const definitions = {
  count: 'Grants committed: accepted awards released in the period',
  total: 'Total committed: the amount of those awards, in minor units of the currency',
} as const;

/** The annual return's grant-making figures, each with its definition and period. */
export function annualReturnOutput(figures: readonly CommittedFigure[], period: Period): Output {
  const rows = byCurrency(figures).flatMap(([currency, held]) =>
    (['all', 'institution', 'individual'] as const).flatMap((group) => {
      const who = group === 'all' ? 'to all recipients' : `to ${group}s`;
      return [
        {
          id: `grants_${group}_count`,
          currency,
          unit: 'grants',
          value: held[group].count,
          definition: `${definitions.count}, ${who}.`,
        },
        {
          id: `grants_${group}_total`,
          currency,
          unit: 'minor',
          value: held[group].minor,
          definition: `${definitions.total}, ${who}.`,
        },
      ];
    }),
  );
  const document = {
    draft: true,
    notice: NOTICE,
    period,
    figures: rows.map((row) => ({ ...row, period })),
  };
  return {
    name: 'annual-return-figures-draft.json',
    contentType: 'application/json',
    bytes: encode(JSON.stringify(document, null, 2)),
  };
}
