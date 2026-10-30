// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Criterion } from '../../contracts/index.ts';
import { optionsOf } from './scoring.ts';

/** The id of a criterion's radio button for one score. The first is where an error summary or a "still to score" link lands. */
export const scoreId = (criterion: Pick<Criterion, 'id'>, score: number): string =>
  `score-${criterion.id}-${String(score)}`;

export const firstScoreId = (criterion: Criterion): string =>
  scoreId(criterion, criterion.scaleMin);

export interface ScoreScaleProps {
  criterion: Criterion;
  /** The id of the criterion's name, which names the group. */
  labelledBy: string;
  /** The ids of what describes the group: its guidance and any error. */
  describedBy: string;
  value: number | null;
  onChange: (score: number) => void;
}

/**
 * A criterion's scale as side-by-side choices. They are the browser's own
 * radio buttons, so Tab enters the group and the arrow keys move along it.
 * The chosen score is filled and carries a tick, so it never rests on colour.
 */
export function ScoreScale({
  criterion,
  labelledBy,
  describedBy,
  value,
  onChange,
}: ScoreScaleProps) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex flex-wrap gap-1.5"
    >
      {optionsOf(criterion).map((score) => (
        <label key={score} className="relative min-w-12 flex-1 cursor-pointer">
          <input
            id={scoreId(criterion, score)}
            type="radio"
            name={`score-${criterion.id}`}
            value={score}
            checked={value === score}
            onChange={() => {
              onChange(score);
            }}
            className="peer sr-only"
          />
          <span
            className={[
              'flex min-h-control items-center justify-center rounded-md border border-edge bg-surface px-1 text-base font-semibold text-ink tabular-nums',
              'transition-colors duration-(--motion-fast) ease-standard hover:border-ink hover:bg-sunken',
              'peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent peer-checked:hover:bg-accent-hover',
              'peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
            ].join(' ')}
          >
            {score}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="pointer-events-none absolute top-0.5 right-0.5 hidden size-3 text-on-accent peer-checked:block"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </label>
      ))}
    </div>
  );
}
