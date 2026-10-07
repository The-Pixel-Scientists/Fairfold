// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

import { range, rows } from './data.ts';
import { reference } from './featured.ts';
import { CheckIcon } from './icons.tsx';

type StageState = 'done' | 'current' | 'upcoming';

const stages: readonly { name: string; state: StageState }[] = [
  { name: 'Intake', state: 'done' },
  { name: 'Eligibility', state: 'done' },
  { name: 'Review', state: 'current' },
  { name: 'Decision', state: 'upcoming' },
];

const words: Readonly<Record<StageState, string>> = {
  done: 'done',
  current: 'current stage, all reviews are in',
  upcoming: 'not started',
};

const item = rows.find((row) => row.reference === reference);

/**
 * Where the application is in the round's stages, and what to do next. Each
 * stage is in words, with a tick for one finished, a ringed tick for the
 * current one and an empty ring for one not started, so colour is never the
 * only sign.
 */
export function StagePath() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-lg border border-divider bg-sunken/50 px-4 py-3">
      <ol aria-label="Stages" className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {stages.map((stage, index) => (
          <li
            key={stage.name}
            aria-current={stage.state === 'current' ? 'step' : undefined}
            className="flex items-center gap-1"
          >
            <span className="flex items-center gap-2 px-1">
              <span
                aria-hidden="true"
                className={cx(
                  'grid size-5 place-items-center rounded-full',
                  stage.state === 'done' && 'bg-success-soft text-success',
                  stage.state === 'current' && 'border-2 border-accent text-accent',
                  stage.state === 'upcoming' && 'border-2 border-edge',
                )}
              >
                {stage.state !== 'upcoming' && <CheckIcon className="size-3.5" />}
              </span>
              <span
                className={cx(
                  'text-body',
                  stage.state === 'current' ? 'font-semibold text-ink' : 'text-muted',
                )}
              >
                {stage.name}
              </span>
              <span className="sr-only">, {words[stage.state]}</span>
            </span>
            {index < stages.length - 1 && (
              <span aria-hidden="true" className="h-px w-5 bg-edge/60" />
            )}
          </li>
        ))}
      </ol>
      {item && (
        <p className="max-w-prose text-body">
          <span className="font-semibold text-ink">Next step: </span>
          <span className="text-muted">
            move it to the decision stage. All {item.reviews.submitted} reviews are in and the
            scores are within {range(item).toFixed(1)} of each other.
          </span>
        </p>
      )}
    </div>
  );
}
