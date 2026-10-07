// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

import type { Stage } from './data.ts';

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="my-2 size-4 shrink-0 rotate-90 self-center text-muted md:mx-3 md:my-0 md:rotate-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

/**
 * The stages of a round as a row of counts with a chevron between each, which
 * points down when they stack on a narrow screen. The rule above a stage is
 * dark once the stage has been reached and heavier at the current one. The
 * state is in words under each count; the rule only backs it up.
 */
export function StagePipeline({ stages }: { stages: readonly Stage[] }) {
  return (
    <ol role="list" aria-label="Stages" className="flex flex-col md:flex-row">
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          aria-current={stage.state === 'Current stage' ? 'step' : undefined}
          className="flex flex-col md:flex-1 md:flex-row"
        >
          <div
            className={cx(
              'flex flex-1 flex-col gap-0.5 border-t-2 pt-3',
              stage.state === 'Not started' ? 'border-divider' : 'border-ink',
              stage.state === 'Current stage' && 'border-t-4 pt-[calc(0.75rem-2px)]',
            )}
          >
            <span className="text-sm font-medium text-muted">
              {index + 1}. {stage.name}
            </span>
            <span className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
              {stage.count}
            </span>
            <span className="text-sm text-ink">{stage.caption}</span>
            <span
              className={cx(
                'text-sm',
                stage.state === 'Current stage' ? 'font-semibold text-ink' : 'text-muted',
              )}
            >
              {stage.state}
            </span>
          </div>
          {index < stages.length - 1 && <Chevron />}
        </li>
      ))}
    </ol>
  );
}
