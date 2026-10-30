// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

import type { Stage, Submission } from '../../../contracts/index.ts';
import { nextStep } from '../words.tsx';

type StageState = 'done' | 'current' | 'upcoming';

const words: Readonly<Record<StageState, string>> = {
  done: 'done',
  current: 'current stage',
  upcoming: 'not started',
};

function Tick() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

/**
 * Where the submission is in its round's stages, and what to do next. Each
 * stage is in words, with a tick for one passed, a ringed tick for the
 * current one and an empty ring for one not reached, so colour is never the
 * only sign.
 */
export function StagePath({
  stages,
  submission,
}: {
  stages: readonly Stage[];
  submission: Submission;
}) {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const current = ordered.findIndex(({ id }) => id === submission.stage.id);
  if (current === -1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-lg border border-divider bg-sunken/50 px-4 py-3">
      <ol aria-label="Stages" className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {ordered.map((stage, index) => {
          const state: StageState =
            index < current ? 'done' : index === current ? 'current' : 'upcoming';
          return (
            <li
              key={stage.id}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex items-center gap-1"
            >
              <span className="flex items-center gap-2 px-1">
                <span
                  aria-hidden="true"
                  className={cx(
                    'grid size-5 place-items-center rounded-full',
                    state === 'done' && 'bg-success-soft text-success',
                    state === 'current' && 'border-2 border-accent text-accent',
                    state === 'upcoming' && 'border-2 border-edge',
                  )}
                >
                  {state !== 'upcoming' && <Tick />}
                </span>
                <span
                  className={cx(
                    'text-body',
                    state === 'current' ? 'font-semibold text-ink' : 'text-muted',
                  )}
                >
                  {stage.name}
                </span>
                <span className="sr-only">, {words[state]}</span>
              </span>
              {index < ordered.length - 1 && (
                <span aria-hidden="true" className="h-px w-5 bg-edge/60" />
              )}
            </li>
          );
        })}
      </ol>
      <p className="max-w-prose text-body">
        <span className="font-semibold text-ink">Next step: </span>
        <span className="text-muted">{nextStep(submission)}</span>
      </p>
    </div>
  );
}
