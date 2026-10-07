// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';

export interface MapBand {
  /** What the shade stands for, such as "Under £15,000". */
  label: string;
  /** The tile's fill from the tokens, from light to dark. */
  fill: string;
  /** The words on that fill. Light shades take ink and the darkest takes the on-accent colour. */
  text: string;
  /** The muted lines on that fill. */
  quiet: string;
}

export interface MapTile {
  key: string;
  name: string;
  /** The big number on the tile. */
  value: string;
  /** Smaller lines under it. */
  lines: readonly string[];
  /** The tile's band, as an index into the bands. */
  band: number;
  /** Row and column on the schematic grid. Columns count in halves, so a row can sit half a tile across. */
  row: number;
  column: number;
  /** An outline for the tiles that matter to the takeaway. */
  outlined?: boolean;
}

export interface TileMapProps {
  tiles: readonly MapTile[];
  bands: readonly MapBand[];
  /** What the outline means. */
  outlineKey: string;
}

/**
 * A schematic map: one rounded square for each area, laid out roughly as the
 * areas lie, shaded from light to dark by band, with the scale underneath.
 * It is not to scale and shows no borders. Detail lines drop out on narrow
 * screens, where the numbers are in the table beneath.
 */
export function TileMap({ tiles, bands, outlineKey }: TileMapProps) {
  return (
    <div className="@container mx-auto flex max-w-[34rem] flex-col gap-5">
      <ul role="list" className="grid grid-cols-6 gap-2 @md:gap-3">
        {tiles.map((tile) => {
          const band = bands[tile.band];
          return (
            <li
              key={tile.key}
              style={{
                gridColumn: `${String(tile.column + 1)} / span 2`,
                gridRowStart: tile.row + 1,
              }}
              className={cx(
                'flex aspect-square min-w-0 flex-col justify-between rounded-lg p-2 @md:p-3',
                band?.fill,
                band?.text,
                tile.outlined
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
                  : 'ring-1 ring-edge/50 ring-inset',
              )}
            >
              <p
                lang="en-GB"
                className="text-xs leading-tight font-semibold break-words hyphens-auto @md:text-body"
              >
                {tile.name}
              </p>
              <div className="flex flex-col">
                <p className="text-base font-semibold tracking-tight tabular-nums @md:text-xl">
                  {tile.value}
                </p>
                {tile.lines.map((line) => (
                  <p
                    key={line}
                    className={cx('hidden text-xs tabular-nums @md:block', band?.quiet)}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-3 text-sm text-muted">
        <ul role="list" className="grid grid-cols-1 gap-x-6 gap-y-2 @sm:grid-cols-2">
          {bands.map((band) => (
            <li key={band.label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cx(
                  'size-4 shrink-0 rounded-sm ring-1 ring-edge/50 ring-inset',
                  band.fill,
                )}
              />
              {band.label}
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-sm ring-2 ring-accent ring-offset-1 ring-offset-surface"
          />
          {outlineKey}
        </p>
      </div>
    </div>
  );
}
