// SPDX-License-Identifier: AGPL-3.0-or-later

import { HorizontalBars } from './HorizontalBars.tsx';

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
}

/** What a step keeps of the step before it. The first step has nothing before it. */
export function kept(steps: readonly FunnelStep[], index: number): number | null {
  const before = steps[index - 1];
  const step = steps[index];
  return before && step && before.count > 0 ? step.count / before.count : null;
}

/**
 * Steps from first to last as bars on one scale, longest at the top. Each bar
 * has a ghost for the people who did not go on, and a note with the count, how
 * many fell away and the share kept from the step before.
 */
export function Funnel({ steps }: { steps: readonly FunnelStep[] }) {
  const first = steps[0]?.count ?? 1;
  return (
    <HorizontalBars
      series={[{ name: 'People', fill: 'fill-accent' }]}
      max={first}
      thickness={18}
      rows={steps.map((step, index) => {
        const before = steps[index - 1];
        const share = kept(steps, index);
        return {
          key: step.key,
          label: (
            <>
              <span className="font-medium">{step.label}</span>
              <span className="block text-sm text-muted tabular-nums">
                {share === null ? 'Starting point' : `${String(Math.round(share * 100))}% kept`}
              </span>
            </>
          ),
          note: (
            <>
              <span className="inline-block w-8 text-right text-lg font-semibold text-ink">
                {step.count}
              </span>
              <span className="ml-2 inline-block w-8 text-left">
                {before && before.count > step.count ? `−${String(before.count - step.count)}` : ''}
              </span>
            </>
          ),
          values: [{ value: step.count, ghost: before?.count }],
        };
      })}
    />
  );
}
