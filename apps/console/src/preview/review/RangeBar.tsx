// SPDX-License-Identifier: AGPL-3.0-or-later

const WIDTH = 112;
const PAD = 6;
const x = (total: number): number => PAD + ((total - 1) / 4) * (WIDTH - 2 * PAD);

/**
 * Where each reviewer's total sits between 1 and 5, as dots joined by a bar
 * from the lowest to the highest. It is for scanning only: the same numbers
 * are in the table's columns, so it is hidden from assistive technology.
 */
export function RangeBar({ totals, wide }: { totals: readonly number[]; wide: boolean }) {
  const low = Math.min(...totals);
  const high = Math.max(...totals);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${String(WIDTH)} 16`} width={WIDTH} height={16}>
      <line
        x1={PAD}
        x2={WIDTH - PAD}
        y1={8}
        y2={8}
        className="stroke-divider"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <line
        x1={x(low)}
        x2={x(high)}
        y1={8}
        y2={8}
        className={wide ? 'stroke-warning' : 'stroke-edge'}
        strokeWidth={4}
        strokeLinecap="round"
      />
      {totals.map((total, index) => (
        <circle
          key={index}
          cx={x(total)}
          cy={8}
          r={3}
          className="fill-surface stroke-ink"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}
