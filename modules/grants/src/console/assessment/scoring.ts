// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A reviewer's scores as the workspace holds them while they type: one entry
// per criterion, a score that may not be chosen yet and a comment. The
// server saves only a criterion that has a score, so an entry with a comment
// alone stays here until it is scored.

import type { Criterion, Score, ScoresInput } from '../../contracts/index.ts';

export interface Entry {
  score: number | null;
  comment: string;
}

export type Entries = Readonly<Record<string, Entry>>;

export const NO_ENTRY: Entry = { score: null, comment: '' };

/** The entries for a rubric, from the scores the server holds. */
export function startingEntries(criteria: readonly Criterion[], scores: readonly Score[]): Entries {
  return Object.fromEntries(
    criteria.map((criterion) => {
      const saved = scores.find((score) => score.criterionId === criterion.id);
      return [criterion.id, saved ? { score: saved.score, comment: saved.comment } : NO_ENTRY];
    }),
  );
}

const entryOf = (entries: Entries, criterion: Criterion): Entry =>
  entries[criterion.id] ?? NO_ENTRY;

/** The criteria with no score yet, in the rubric's order. */
export function unscored(criteria: readonly Criterion[], entries: Entries): Criterion[] {
  return criteria.filter((criterion) => entryOf(entries, criterion).score === null);
}

/** What the server is sent: a score for each criterion that has one, in the rubric's order. */
export function toInput(criteria: readonly Criterion[], entries: Entries): ScoresInput {
  return {
    scores: criteria.flatMap((criterion) => {
      const { score, comment } = entryOf(entries, criterion);
      return score === null ? [] : [{ criterionId: criterion.id, score, comment: comment.trim() }];
    }),
  };
}

/** The weight of each scored criterion times its score, over the weight of those criteria; null when none is scored. Rounded to two places, as the server does. */
export function weightedTotal(criteria: readonly Criterion[], entries: Entries): number | null {
  let weights = 0;
  let points = 0;
  for (const criterion of criteria) {
    const { score } = entryOf(entries, criterion);
    if (score === null) continue;
    weights += criterion.weight;
    points += criterion.weight * score;
  }
  return weights === 0 ? null : Math.round((points / weights) * 100) / 100;
}

/** The lowest and highest score any criterion allows. */
export function scaleOf(criteria: readonly Criterion[]): { min: number; max: number } {
  return {
    min: Math.min(...criteria.map((criterion) => criterion.scaleMin)),
    max: Math.max(...criteria.map((criterion) => criterion.scaleMax)),
  };
}

/** The scores a criterion allows, lowest first. */
export function optionsOf({ scaleMin, scaleMax }: Criterion): number[] {
  return Array.from({ length: scaleMax - scaleMin + 1 }, (_, index) => scaleMin + index);
}

/** A rubric gives a scale its numbers and no words, so the scale is described by its two ends. */
export const scaleWords = ({ scaleMin, scaleMax }: Criterion): string =>
  `${String(scaleMin)} is the lowest score and ${String(scaleMax)} is the highest`;
