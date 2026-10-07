// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

export interface ColumnTick {
  /** The column the tick sits under. */
  index: number;
  label: string;
  /** Start and end keep the first and last labels inside the chart. */
  anchor?: 'start' | 'middle' | 'end';
  /** The mark for the day that matters: darker, with a line down from the axis. */
  strong?: boolean;
  /** Hidden when the chart is under 32rem wide, where labels would run into each other. */
  optional?: boolean;
}

export interface DailyColumnsProps {
  /** One count for each day, in order. */
  values: readonly number[];
  /** The top of the scale. Gridlines fall at every 5 below it. */
  max: number;
  /** Names the gridline that is highest, such as "submissions a day". */
  unit: string;
  /** Columns from here to the end are drawn in ink and, on charts 32rem or wider, labelled. The rest are quiet. */
  emphasisFrom: number;
  /** A bracket over the emphasised columns, with its words above. */
  bracket: string;
  ticks: readonly ColumnTick[];
}

const HEIGHT = 372;
const TOP = 56;
const BASELINE = 338;
const INSET = 0.14;

const percent = (value: number) => `${String(value * 100)}%`;

/**
 * Columns over time, one for each day, with gridlines, a bracket over the
 * days that matter and direct labels on those days. Columns and ticks use
 * percentages across the width, so the chart is sharp at any size.
 */
export function DailyColumns({
  values,
  max,
  unit,
  emphasisFrom,
  bracket,
  ticks,
}: DailyColumnsProps) {
  const days = values.length;
  const x = (index: number) => percent(index / days);
  const scale = (BASELINE - TOP) / max;
  const gridlines = Array.from({ length: Math.floor(max / 5) + 1 }, (_, step) => step * 5);
  const highest = gridlines[gridlines.length - 1];

  return (
    <div className="@container">
      <svg
        aria-hidden="true"
        focusable="false"
        width="100%"
        height={HEIGHT}
        className="block overflow-visible"
      >
        {gridlines.map((line) => {
          const y = BASELINE - line * scale;
          return (
            <g key={line}>
              <line
                x1={0}
                x2="100%"
                y1={y}
                y2={y}
                className={line === 0 ? 'stroke-edge' : 'stroke-divider'}
              />
              {line > 0 && (
                <text x={0} y={y - 6} className="fill-muted text-xs tabular-nums">
                  {line === highest ? `${String(line)} ${unit}` : line}
                </text>
              )}
            </g>
          );
        })}

        {values.map((value, index) => {
          const strong = index >= emphasisFrom;
          const top = BASELINE - value * scale;
          return (
            <g key={index}>
              <rect
                x={x(index + INSET)}
                y={top}
                width={percent((1 - 2 * INSET) / days)}
                height={value * scale}
                className={strong ? 'fill-accent' : 'fill-edge'}
              />
              {strong && (
                <text
                  x={x(index + 0.5)}
                  y={top - 6}
                  textAnchor="middle"
                  className="hidden fill-ink text-sm font-semibold tabular-nums @lg:block"
                >
                  {value}
                </text>
              )}
            </g>
          );
        })}

        <svg
          x={x(emphasisFrom + INSET)}
          y={0}
          width={percent((days - emphasisFrom - 2 * INSET) / days)}
          height={40}
          overflow="visible"
        >
          <text x="100%" y={14} textAnchor="end" className="fill-ink text-sm font-medium">
            {bracket}
          </text>
          <g className="stroke-ink" strokeWidth={1.5}>
            <line x1={0} x2="100%" y1={28} y2={28} />
            <line x1={0} x2={0} y1={28} y2={35} />
            <line x1="100%" x2="100%" y1={28} y2={35} />
          </g>
        </svg>

        {ticks.map((tick) => (
          <g key={tick.index}>
            {tick.strong && (
              <line
                x1="100%"
                x2="100%"
                y1={BASELINE}
                y2={BASELINE + 8}
                className="stroke-ink"
                strokeWidth={2}
              />
            )}
            <text
              x={x(tick.index + (tick.anchor === 'end' ? 1 : tick.anchor === 'start' ? 0 : 0.5))}
              y={BASELINE + 26}
              textAnchor={tick.anchor ?? 'middle'}
              className={cx(
                'text-sm',
                tick.strong ? 'fill-ink font-semibold' : 'fill-muted',
                tick.optional && 'hidden @lg:block',
              )}
            >
              {tick.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
