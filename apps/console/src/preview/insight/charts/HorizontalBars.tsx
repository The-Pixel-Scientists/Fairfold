// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

export interface BarSeries {
  /** Names the bar. In a pair it leads the labels in the first row, such as "Requested £98,600". */
  name: string;
  /** An SVG fill class from the tokens, such as `fill-accent`. */
  fill: string;
}

export interface BarValue {
  /** The bar's length, or null when the number is withheld and no bar is drawn. */
  value: number | null;
  /** The label at the end of the bar, such as "£98,600". For a withheld value it says why. */
  text?: string;
  /** A fill that replaces the series' own for this bar. */
  fill?: string;
  /** A fainter bar from the end of this one to here, for what fell away. */
  ghost?: number;
}

export interface BarRow {
  key: string;
  label: ReactNode;
  /** Text at the end of the row, such as "Award rate 33%". */
  note?: ReactNode;
  /** Fades the bars, not the words, for a row that is not the focus. */
  faded?: boolean;
  /** One value for each series, in order. */
  values: readonly BarValue[];
}

export interface HorizontalBarsProps {
  series: readonly BarSeries[];
  rows: readonly BarRow[];
  /** A heading over the notes, such as "Award rate". It shows beside the bars and drops out below 24rem, where each note says what it is. */
  noteHeading?: string;
  /** The value that fills the track. */
  max: number;
  /** The bars' thickness in pixels. Defaults to 8 for pairs and 10 for one. */
  thickness?: number;
}

/** The space between bars in a row: wide enough to give each bar's label its own line. */
const GAP_WITH_LABELS = 12;
const GAP_BETWEEN = 4;
const STUB = 44;

/** Names the bars where there is no room to label them in the first row. */
function Key({ series }: { series: readonly BarSeries[] }) {
  return (
    <ul role="list" className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted @sm:hidden">
      {series.map((item) => (
        <li key={item.name} className="flex items-center gap-2">
          <svg aria-hidden="true" width="18" height="8" className="shrink-0">
            <rect width="18" height="8" rx="4" className={item.fill} />
          </svg>
          {item.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Rows of bars on one scale, one bar for each series in a row. Labels sit
 * beside the bar, in the row, where they fit: the row's name at the start, the
 * value at the end of each bar and an optional note at the end of the row.
 * In a pair the first row's values carry the series names, and a key stands in
 * for them below 24rem.
 * Withheld numbers show as a dashed stub with the reason. Below 24rem the
 * name and note share a line above the bars. The bars use percentages, so the
 * chart needs no measuring and stays sharp at any width and zoom.
 */
export function HorizontalBars({ series, rows, max, thickness, noteHeading }: HorizontalBarsProps) {
  const paired = series.length > 1;
  const thick = thickness ?? (paired ? 8 : 10);
  const radius = Math.min(thick / 2, 5);
  const hasNotes = rows.some((row) => row.note !== undefined);
  const hasText = rows.some((row) => row.values.some((item) => item.text !== undefined));
  const gap = hasText && paired ? GAP_WITH_LABELS : GAP_BETWEEN;
  const height = series.length * thick + (series.length - 1) * gap;

  return (
    <div className="@container">
      {paired && <Key series={series} />}
      <ul
        role="list"
        className={cx(
          'grid grid-cols-1 @sm:justify-start @sm:gap-x-6',
          hasNotes
            ? '@sm:grid-cols-[fit-content(min(40%,16rem))_minmax(0,36rem)_auto]'
            : '@sm:grid-cols-[fit-content(min(40%,16rem))_minmax(0,36rem)]',
        )}
      >
        {hasNotes && noteHeading && (
          <li
            aria-hidden="true"
            className="hidden border-b border-divider pb-2 text-right text-sm font-medium text-muted @sm:col-span-full @sm:grid @sm:grid-cols-subgrid"
          >
            <span className="col-start-3">{noteHeading}</span>
          </li>
        )}
        {rows.map((row, rowIndex) => (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 border-b border-divider py-3 last:border-b-0 @sm:col-span-full @sm:grid-cols-subgrid"
          >
            <div className="min-w-0 text-body text-ink">{row.label}</div>
            <div
              className={cx(
                'order-last col-span-2 @sm:order-none @sm:col-span-1',
                hasText && (paired ? 'pr-24 @sm:pr-44' : 'pr-24'),
              )}
            >
              <svg
                aria-hidden="true"
                focusable="false"
                width="100%"
                height={height}
                className="block overflow-visible"
              >
                {row.values.map((item, index) => {
                  const top = index * (thick + gap);
                  const middle = top + thick / 2;
                  const fill = item.fill ?? series[index]?.fill ?? 'fill-accent';
                  const fade = row.faded && 'opacity-35';
                  const length = (value: number) => `${String((value / max) * 100)}%`;
                  return (
                    <g key={index}>
                      {item.ghost !== undefined && (
                        <rect
                          x={0}
                          y={top}
                          width={length(item.ghost)}
                          height={thick}
                          rx={radius}
                          className={cx('fill-sunken stroke-divider', fade)}
                        />
                      )}
                      {item.value === null ? (
                        <>
                          <rect
                            x={0.5}
                            y={top + 0.5}
                            width={STUB}
                            height={thick - 1}
                            rx={(thick - 1) / 2}
                            fill="none"
                            strokeDasharray="3 2"
                            className="stroke-edge"
                          />
                          <text
                            x={STUB + 8}
                            y={middle}
                            dy="0.35em"
                            className="fill-muted text-sm italic"
                          >
                            {item.text}
                          </text>
                        </>
                      ) : (
                        <>
                          <rect
                            x={0}
                            y={top}
                            width={length(item.value)}
                            height={thick}
                            rx={radius}
                            className={cx(fill, fade)}
                          />
                          {item.text !== undefined && (
                            <text
                              x={length(item.value)}
                              dx={8}
                              y={middle}
                              dy="0.35em"
                              className="fill-ink text-sm font-medium tabular-nums"
                            >
                              {paired && rowIndex === 0 && (
                                <tspan className="hidden fill-muted font-normal @sm:inline">
                                  {series[index]?.name}{' '}
                                </tspan>
                              )}
                              {item.text}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
            {hasNotes && (
              <div className="text-right text-sm whitespace-nowrap text-muted tabular-nums">
                {row.note}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
