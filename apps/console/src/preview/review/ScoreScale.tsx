// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon } from './icons.tsx';
import { scale } from '../story.ts';

export interface ScoreScaleProps {
  /** Groups the radio buttons. */
  name: string;
  /** The id of the criterion's name, which names the group. */
  labelledBy: string;
  /** The id of the guidance, which describes the group. */
  describedBy: string;
  /** The ids of the radio buttons start with this, then the score. The first is the error summary's target. */
  idPrefix: string;
  value: number | null;
  onChange: (score: number) => void;
}

/**
 * A 1 to 5 score as five side-by-side choices, each with its word (Weak to
 * Strong). They are the browser's own radio buttons, so Tab enters the group
 * and the arrow keys move along it. The chosen score is filled and carries a
 * tick, so it never rests on colour. Where there is no room for the words,
 * they stay in the accessible name and the chosen word is written below.
 */
export function ScoreScale({
  name,
  labelledBy,
  describedBy,
  idPrefix,
  value,
  onChange,
}: ScoreScaleProps) {
  const chosen = scale.find((option) => option.score === value);
  return (
    <div className="@container flex flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="grid grid-cols-5 gap-1.5"
      >
        {scale.map((option) => (
          <label key={option.score} className="relative cursor-pointer">
            <input
              id={`${idPrefix}-${String(option.score)}`}
              type="radio"
              name={name}
              value={option.score}
              checked={value === option.score}
              onChange={() => {
                onChange(option.score);
              }}
              className="peer sr-only"
            />
            <span
              className={[
                'flex min-h-12 flex-col items-center justify-center rounded-md border border-edge bg-surface px-1 py-1.5 text-center leading-tight text-ink',
                'transition-colors duration-(--motion-fast) ease-standard hover:border-ink hover:bg-sunken',
                'peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent peer-checked:hover:bg-accent-hover',
                'peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
              ].join(' ')}
            >
              <span className="text-base font-semibold tabular-nums">{option.score}</span>
              <span className="sr-only @min-[22rem]:not-sr-only @min-[22rem]:text-xs">
                {option.label}
              </span>
            </span>
            <CheckIcon className="pointer-events-none absolute top-1 right-1 hidden size-3 text-on-accent @min-[22rem]:peer-checked:block" />
          </label>
        ))}
      </div>
      <p className="text-sm text-muted @min-[22rem]:hidden">
        {chosen ? `${String(chosen.score)} of 5: ${chosen.label}` : '1 is Weak and 5 is Strong'}
      </p>
    </div>
  );
}
