// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';

export interface DiagramNode {
  id: string;
  /** The table's name, in code type. */
  label: string;
  /** A line under the name, such as "4,612 rows". */
  detail: string;
  /** Position on the grid. */
  column: number;
  row: number;
  /** A dashed box, for a table that another Fairfold tool owns. */
  shared?: boolean;
  /** A line above the box. */
  caption?: string;
}

export interface DiagramLink {
  /** The table that has one. */
  from: string;
  /** The table that has many, or one when `one` is set. */
  to: string;
  one?: boolean;
}

export interface ModelDiagramProps {
  /** Names the diagram for screen readers, who also get the same links as a table. */
  label: string;
  nodes: readonly DiagramNode[];
  links: readonly DiagramLink[];
}

const WIDTH = 156;
const HEIGHT = 56;
const COLUMN_GAP = 52;
const ROW_GAP = 56;
const PAD = 2;

const left = (column: number) => PAD + column * (WIDTH + COLUMN_GAP);
const top = (row: number) => PAD + row * (HEIGHT + ROW_GAP);

/**
 * Tables as boxes and the links between them as lines: a bar where a row has
 * one parent and a crow's foot where a parent has many rows. It scrolls
 * sideways in its own named region where it is wider than the screen. It never
 * draws smaller than its own 62rem, so the words stay at their real size.
 */
export function ModelDiagram({ label, nodes, links }: ModelDiagramProps) {
  const titleId = useId();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const columns = Math.max(...nodes.map((node) => node.column)) + 1;
  const rows = Math.max(...nodes.map((node) => node.row)) + 1;
  const width = left(columns) - COLUMN_GAP + PAD;
  const height = top(rows) - ROW_GAP + PAD + 18;

  return (
    <div className="@container flex flex-col gap-2">
      <div role="region" aria-label="Data model diagram" tabIndex={0} className="overflow-x-auto">
        <svg
          role="img"
          aria-labelledby={titleId}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          className="block h-auto w-full min-w-[62rem]"
        >
          <title id={titleId}>{label}</title>
          {links.map((link) => {
            const parent = byId.get(link.from);
            const child = byId.get(link.to);
            if (!parent || !child) return null;
            const down = parent.column === child.column;
            const [dx, dy] = down ? [0, 1] : [1, 0];
            const start = down
              ? { x: left(parent.column) + WIDTH / 2, y: top(parent.row) + HEIGHT }
              : { x: left(parent.column) + WIDTH, y: top(parent.row) + HEIGHT / 2 };
            const end = down
              ? { x: start.x, y: top(child.row) }
              : { x: left(child.column), y: top(child.row) + HEIGHT / 2 };
            const turn = start.x + COLUMN_GAP / 2;
            const path =
              down || start.y === end.y
                ? `M${String(start.x)} ${String(start.y)}L${String(end.x)} ${String(end.y)}`
                : `M${String(start.x)} ${String(start.y)}H${String(turn)}V${String(end.y)}H${String(end.x)}`;
            /** A short line across the link, `distance` along it from a point. */
            const bar = (from: { x: number; y: number }, distance: number) =>
              `M${String(from.x + dx * distance + dy * 5)} ${String(from.y + dy * distance - dx * 5)}L${String(from.x + dx * distance - dy * 5)} ${String(from.y + dy * distance + dx * 5)}`;
            const fork = `M${String(end.x - dx * 13)} ${String(end.y - dy * 13)}L${String(end.x + dy * 6)} ${String(end.y - dx * 6)}M${String(end.x - dx * 13)} ${String(end.y - dy * 13)}L${String(end.x - dy * 6)} ${String(end.y + dx * 6)}`;
            return (
              <g
                key={`${link.from}-${link.to}`}
                fill="none"
                strokeWidth={1.5}
                className="stroke-edge"
              >
                <path d={path} />
                <path d={bar(start, 10)} />
                <path d={link.one ? bar(end, -10) : fork} />
              </g>
            );
          })}
          {nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={left(node.column)}
                y={top(node.row)}
                width={WIDTH}
                height={HEIGHT}
                rx={8}
                strokeWidth={1.5}
                strokeDasharray={node.shared ? '5 3' : undefined}
                className="fill-surface stroke-ink"
              />
              <text
                x={left(node.column) + 14}
                y={top(node.row) + 23}
                className="fill-ink font-mono text-sm font-semibold"
              >
                {node.label}
              </text>
              <text
                x={left(node.column) + 14}
                y={top(node.row) + 42}
                className="fill-muted text-xs tabular-nums"
              >
                {node.detail}
              </text>
              {node.caption && (
                <text
                  x={left(node.column) + WIDTH / 2}
                  y={top(node.row) - 9}
                  textAnchor="middle"
                  className="fill-muted text-xs"
                >
                  {node.caption}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <p className="text-sm text-muted @min-[62rem]:hidden">
        Scroll sideways to see the whole diagram.
      </p>
    </div>
  );
}
