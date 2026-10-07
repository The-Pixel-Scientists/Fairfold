// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, Tag, buttonClassName } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { pounds } from '../story.ts';
import { ChartPanel } from './ChartPanel.tsx';
import { HorizontalBars } from './charts/HorizontalBars.tsx';
import { TileMap } from './charts/TileMap.tsx';
import type { MapBand } from './charts/TileMap.tsx';
import { percent } from './format.ts';
import {
  amountBands,
  areas,
  bandOf,
  mostDeprived,
  perThousand,
  totalAmount,
} from './geographyData.ts';
import type { Area } from './geographyData.ts';
import { InsightFrame } from './InsightFrame.tsx';

/**
 * Four steps spread from nearly paper to nearly ink. Each band's words are
 * chosen for its own fill in each scheme so they reach 4.5:1: the third band
 * takes ink in light and the on-accent colour in dark, and muted lines stop
 * where muted no longer reaches the ratio.
 */
const shades: readonly Omit<MapBand, 'label'>[] = [
  { fill: 'bg-ink/10', text: 'text-ink', quiet: 'text-muted' },
  { fill: 'bg-ink/28', text: 'text-ink', quiet: 'text-ink' },
  {
    fill: 'bg-ink/50',
    text: 'text-ink dark:text-on-accent',
    quiet: 'text-ink dark:text-on-accent',
  },
  { fill: 'bg-ink/85', text: 'text-on-accent', quiet: 'text-on-accent' },
];

const bands: readonly MapBand[] = amountBands.map((band, index) => ({
  label: band.label,
  fill: shades[index]?.fill ?? '',
  text: shades[index]?.text ?? '',
  quiet: shades[index]?.quiet ?? '',
}));

const decileNote = (area: Area) =>
  area.decile === 1 ? ', most deprived' : area.decile === 2 ? ', next most deprived' : '';

const grantsText = (area: Area) =>
  `${String(area.grants)} ${area.grants === 1 ? 'grant' : 'grants'}`;
const perThousandOf = (area: Area) => perThousand(area.amount, area.residents);

const columns: readonly Column<Area>[] = [
  { key: 'area', header: 'Area', rowHeader: true, cell: (area) => area.name },
  { key: 'decile', header: 'Deprivation decile', align: 'end', cell: (area) => area.decile },
  { key: 'grants', header: 'Grants', align: 'end', cell: (area) => area.grants },
  { key: 'amount', header: 'Amount', align: 'end', cell: (area) => pounds(area.amount) },
  {
    key: 'share',
    header: 'Share of the money',
    align: 'end',
    cell: (area) => percent(area.amount, totalAmount),
  },
  {
    key: 'perThousand',
    header: 'Pounds per 1,000 residents',
    align: 'end',
    cell: (area) => pounds(perThousandOf(area)),
  },
];

const byAmount = [...areas].sort((a, b) => b.amount - a.amount);
const byDecile = [...areas].sort((a, b) => a.decile - b.decile);
const deprivedAmount = areas.filter(mostDeprived).reduce((sum, area) => sum + area.amount, 0);
const rateOf = (list: readonly Area[]) =>
  perThousand(
    list.reduce((sum, area) => sum + area.amount, 0),
    list.reduce((sum, area) => sum + area.residents, 0),
  );
const [leastFunded] = [...areas].sort((a, b) => perThousandOf(a) - perThousandOf(b));

export default function Geography() {
  return (
    <InsightFrame
      title="Where the money goes"
      description="Spring 2027 grants by area, set against how many people live there and how deprived the area is."
      actions={<Button>Export areas as CSV</Button>}
    >
      <div className="grid gap-6 lg:grid-cols-12">
        <ChartPanel
          className="lg:col-span-7"
          title="Grants by area"
          takeaway={`The two most deprived areas received ${percent(deprivedAmount, totalAmount)} of the money.`}
          summary={`A schematic map of seven areas, shaded by the amount awarded. ${byAmount
            .map(
              (area) =>
                `${area.name}: ${pounds(area.amount)} in ${grantsText(area)}, deprivation decile ${String(area.decile)}`,
            )
            .join('. ')}.`}
          numbers={
            <DataTable
              caption="Amount, grants and deprivation for each area"
              captionHidden
              columns={columns}
              rows={byAmount}
              rowKey={(area) => area.id}
            />
          }
        >
          <TileMap
            bands={bands}
            outlineKey="Outlined: the two most deprived areas, deciles 1 and 2"
            tiles={areas.map((area) => ({
              key: area.id,
              name: area.name,
              value: pounds(area.amount),
              lines: [
                grantsText(area),
                `Decile ${String(area.decile)}`,
                `${pounds(perThousandOf(area))} per 1,000`,
              ],
              band: bandOf(area.amount),
              row: area.row,
              column: area.column,
              outlined: mostDeprived(area),
            }))}
          />
        </ChartPanel>

        <ChartPanel
          className="lg:col-span-5 lg:self-start"
          title="Pounds per 1,000 residents"
          footnote="The two most deprived areas, deciles 1 and 2, are highlighted. Decile 1 is the most deprived tenth of areas in England."
          takeaway={
            leastFunded
              ? `The two most deprived areas got ${pounds(rateOf(areas.filter(mostDeprived)))} for every 1,000 residents, against ${pounds(rateOf(areas.filter((area) => !mostDeprived(area))))} in the other five. ${leastFunded.name}, in decile ${String(leastFunded.decile)}, got the least: ${pounds(perThousandOf(leastFunded))}.`
              : ''
          }
          summary={`Bars for seven areas, from the most deprived to the least. ${byDecile
            .map(
              (area) =>
                `${area.name}, decile ${String(area.decile)}: ${pounds(perThousandOf(area))}`,
            )
            .join('. ')}.`}
          numbers={
            <DataTable
              caption="Pounds per 1,000 residents, from the most deprived area to the least"
              captionHidden
              columns={[
                { key: 'area', header: 'Area', rowHeader: true, cell: (area: Area) => area.name },
                {
                  key: 'decile',
                  header: 'Decile',
                  align: 'end',
                  cell: (area: Area) => area.decile,
                },
                {
                  key: 'residents',
                  header: 'Residents',
                  align: 'end',
                  cell: (area: Area) => area.residents.toLocaleString('en-GB'),
                },
                {
                  key: 'perThousand',
                  header: 'Pounds per 1,000',
                  align: 'end',
                  cell: (area: Area) => pounds(perThousandOf(area)),
                },
              ]}
              rows={byDecile}
              rowKey={(area) => area.id}
            />
          }
        >
          <HorizontalBars
            series={[{ name: 'Pounds per 1,000 residents', fill: 'fill-edge' }]}
            max={Math.max(...areas.map(perThousandOf))}
            rows={byDecile.map((area) => ({
              key: area.id,
              label: (
                <>
                  <span className="font-medium">{area.name}</span>
                  <span className="block text-sm text-muted tabular-nums">
                    {`Decile ${String(area.decile)}${decileNote(area)}`}
                  </span>
                </>
              ),
              values: [
                {
                  value: perThousandOf(area),
                  text: pounds(perThousandOf(area)),
                  fill: mostDeprived(area) ? 'fill-accent' : undefined,
                },
              ],
            }))}
          />
        </ChartPanel>
      </div>

      <section
        aria-labelledby="funding-map"
        className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-lg bg-sunken p-gutter"
      >
        <div className="flex max-w-prose flex-col items-start gap-1">
          <Tag>Fairfold Funding Map</Tag>
          <h2 id="funding-map" className="text-lg font-semibold tracking-tight text-ink">
            See other funders here too
          </h2>
          <p className="text-body text-muted">
            Fairfold Funding Map shows grants from other funders in these same areas, so you can see
            where your money adds to theirs and where nobody is funding yet.
          </p>
        </div>
        <a
          href="https://funding-map.example.org/northfield"
          className={buttonClassName('secondary')}
        >
          Open Funding Map
        </a>
      </section>
    </InsightFrame>
  );
}
