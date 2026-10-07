// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

export interface DotRow {
  key: string;
  label: ReactNode;
  /** The dot. */
  value: number;
  /** The line behind the dot, from lowest to highest. */
  low: number;
  high: number;
  /** Words under the dot, such as "0.2 above the panel". */
  caption: string;
  /** Marks the row as the one to look at: a ringed dot and a bolder caption in ink. Position and words say it, not a colour. */
  flagged?: boolean;
}

export interface DotPlotProps {
  rows: readonly DotRow[];
  /** The left and right ends of the scale. */
  domain: readonly [number, number];
  /** Where the scale is labelled and gridlines fall. */
  ticks: readonly number[];
  /** The line every row is read against, dashed, with its label above the first row. */
  reference: { value: number; label: string };
  /** Names the scale under the last row, such as "Weighted score out of 5". */
  axis: string;
}

/** A band of the surface colour behind text. It is wide enough that the glyphs' bands join, so the dashed line never shows between letters. */
const halo = 'stroke-surface stroke-[8px] [paint-order:stroke] [stroke-linejoin:round]';

const ROW = 64;
const MIDDLE = 30;

/**
 * One dot for each row on a shared scale, with the row's range as a line
 * behind it and a dashed reference line through every row. Names sit at the
 * start of the row, the number above the dot and the gap to the reference in
 * words under it, so the one that stands out is marked by text as well as by
 * position. Each row is its own SVG in percentages, so the gridlines join up
 * and nothing needs measuring.
 */
export function DotPlot({ rows, domain, ticks, reference, axis }: DotPlotProps) {
  const [start, end] = domain;
  const at = (value: number) => `${String(((value - start) / (end - start)) * 100)}%`;
  const grid = (
    <>
      {ticks.map((tick) => (
        <line key={tick} x1={at(tick)} x2={at(tick)} y1={0} y2="100%" className="stroke-divider" />
      ))}
      <line
        x1={at(reference.value)}
        x2={at(reference.value)}
        y1={0}
        y2="100%"
        strokeDasharray="4 3"
        className="stroke-ink"
      />
    </>
  );
  const cell = 'min-w-0 px-7';

  return (
    <div className="@container">
      <ul
        role="list"
        className="grid grid-cols-1 @md:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)] @md:gap-x-4"
      >
        <li className="grid @md:col-span-full @md:grid-cols-subgrid">
          <div className={cx(cell, 'col-start-1 @md:col-start-2')}>
            <svg
              aria-hidden="true"
              focusable="false"
              width="100%"
              height={26}
              className="block overflow-visible"
            >
              <line
                x1={at(reference.value)}
                x2={at(reference.value)}
                y1={20}
                y2="100%"
                strokeDasharray="4 3"
                className="stroke-ink"
              />
              <text
                x={at(reference.value)}
                y={12}
                textAnchor="middle"
                className="fill-ink text-sm font-semibold"
              >
                {reference.label}
              </text>
            </svg>
          </div>
        </li>
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-1 border-t border-divider @md:col-span-full @md:grid-cols-subgrid @md:items-center"
          >
            <div className="min-w-0 pt-3 @md:py-3">{row.label}</div>
            <div className={cell}>
              <svg
                aria-hidden="true"
                focusable="false"
                width="100%"
                height={ROW}
                className="block overflow-visible"
              >
                {grid}
                <rect
                  x={at(row.low)}
                  y={MIDDLE - 2}
                  width={`${String(((row.high - row.low) / (end - start)) * 100)}%`}
                  height={4}
                  rx={2}
                  className="fill-edge"
                />
                <text
                  x={at(row.low)}
                  dx={-8}
                  y={MIDDLE}
                  dy="0.35em"
                  textAnchor="end"
                  className="fill-muted text-xs tabular-nums"
                >
                  {row.low.toFixed(1)}
                </text>
                <text
                  x={at(row.high)}
                  dx={8}
                  y={MIDDLE}
                  dy="0.35em"
                  className="fill-muted text-xs tabular-nums"
                >
                  {row.high.toFixed(1)}
                </text>
                {row.flagged && (
                  <circle
                    cx={at(row.value)}
                    cy={MIDDLE}
                    r={10}
                    fill="none"
                    strokeWidth={1.5}
                    className="stroke-ink"
                  />
                )}
                <circle
                  cx={at(row.value)}
                  cy={MIDDLE}
                  r={row.flagged ? 6 : 5.5}
                  className="fill-accent stroke-surface"
                  strokeWidth={2}
                />
                <text
                  x={at(row.value)}
                  y={MIDDLE - 15}
                  textAnchor="middle"
                  className={cx('fill-ink text-sm font-semibold tabular-nums', halo)}
                >
                  {row.value.toFixed(1)}
                </text>
                <text
                  x={at(row.value)}
                  y={MIDDLE + 29}
                  textAnchor="middle"
                  className={cx(
                    'text-xs',
                    halo,
                    row.flagged ? 'fill-ink font-semibold' : 'fill-muted',
                  )}
                >
                  {row.caption}
                </text>
              </svg>
            </div>
          </li>
        ))}
        <li className="grid border-t border-divider @md:col-span-full @md:grid-cols-subgrid">
          <div className={cx(cell, 'col-start-1 @md:col-start-2')}>
            <svg
              aria-hidden="true"
              focusable="false"
              width="100%"
              height={44}
              className="block overflow-visible"
            >
              {ticks.map((tick) => (
                <text
                  key={tick}
                  x={at(tick)}
                  y={18}
                  textAnchor="middle"
                  className="fill-muted text-sm tabular-nums"
                >
                  {tick}
                </text>
              ))}
              <text x="50%" y={38} textAnchor="middle" className="fill-muted text-xs">
                {axis}
              </text>
            </svg>
          </div>
        </li>
      </ul>
    </div>
  );
}
