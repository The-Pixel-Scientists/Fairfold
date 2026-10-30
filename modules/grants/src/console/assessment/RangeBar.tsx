// SPDX-License-Identifier: AGPL-3.0-or-later

const WIDTH = 112;
const PAD = 6;

/**
 * Where each reviewer's total sits on the scale, as dots joined by a bar from
 * the lowest to the highest. It is for scanning only: the same numbers are in
 * the table's columns, so it is hidden from assistive technology. A wide
 * spread has a thicker bar, so it does not rest on colour.
 */
export function RangeBar({
  totals,
  scale,
  wide,
}: {
  totals: readonly number[];
  /** The highest total the bar can show; its lowest is 0. */
  scale: number;
  wide: boolean;
}) {
  if (totals.length === 0) return null;
  const x = (total: number): number => PAD + (total / scale) * (WIDTH - 2 * PAD);
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
        x1={x(Math.min(...totals))}
        x2={x(Math.max(...totals))}
        y1={8}
        y2={8}
        className={wide ? 'stroke-warning' : 'stroke-edge'}
        strokeWidth={wide ? 7 : 4}
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
