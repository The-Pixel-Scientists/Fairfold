// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the regulatory reports read from the platform (ADR 0016). This code
// never queries another module's tables: grants' server answers the two
// questions below inside the caller's transaction, and the platform passes
// its answers in. Only accepted decisions released within the period count,
// as grants counts them (architecture rule 8). Nothing here is sent anywhere.

import { idSchema } from '@pixel-scientists/domain';
import { currencies, type Currency } from '@pixel-scientists/domain/platform';

import type { Tx } from '../context.ts';

/** Whole days, both included, as the run's contract holds them: `YYYY-MM-DD`. */
export interface Period {
  readonly start: string;
  readonly end: string;
}

/** Grants' 360Giving file for the period, built by its own identifier rule and checked against its schema. */
export type ThreeSixtyGivingBuild =
  | { readonly status: 'grants_off' }
  | {
      readonly status: 'built';
      readonly file: { readonly grants: readonly unknown[] };
      readonly summary: {
        readonly grants: number;
        readonly unverifiedRecipients: readonly unknown[];
      };
    };

/** Committed grants as figures: never a row for one grant, and never a name. */
export interface CommittedFigure {
  readonly programmeId: string;
  readonly programmeTitle: string;
  readonly recipient: 'institution' | 'individual';
  readonly currency: Currency;
  readonly count: number;
  /** In the currency's minor unit. */
  readonly amountMinor: number;
}

const FIGURE_KEYS = [
  'programmeId',
  'programmeTitle',
  'recipient',
  'currency',
  'count',
  'amountMinor',
] as const;

/** Whether a row is exactly a figure: these keys and no others, each of its type. */
export function isCommittedFigure(row: unknown): row is CommittedFigure {
  if (typeof row !== 'object' || row === null) return false;
  const keys = Object.keys(row);
  if (keys.length !== FIGURE_KEYS.length || !FIGURE_KEYS.every((key) => keys.includes(key))) {
    return false;
  }
  const figure = row as Record<(typeof FIGURE_KEYS)[number], unknown>;
  return (
    idSchema.safeParse(figure.programmeId).success &&
    typeof figure.programmeTitle === 'string' &&
    figure.programmeTitle.length > 0 &&
    figure.programmeTitle.length <= 120 &&
    (figure.recipient === 'institution' || figure.recipient === 'individual') &&
    currencies.some((currency) => currency === figure.currency) &&
    Number.isSafeInteger(figure.count) &&
    (figure.count as number) >= 1 &&
    Number.isSafeInteger(figure.amountMinor) &&
    (figure.amountMinor as number) >= 0
  );
}

/** One row for each programme, recipient type and currency that has a released award in the period. */
export type CommittedFigures =
  | { readonly status: 'grants_off' }
  | { readonly status: 'figures'; readonly rows: readonly unknown[] };

/** Both run inside the job's transaction, so the tenant is the job's. */
export interface PublicationSources {
  threeSixtyGiving(tx: Tx, period: Period): Promise<ThreeSixtyGivingBuild>;
  committedFigures(tx: Tx, period: Period): Promise<CommittedFigures>;
}
