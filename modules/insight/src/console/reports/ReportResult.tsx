// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { ReportDefinition, ReportResult } from '../../contracts/index.ts';
import { plainName } from '../format.ts';

type Cell = ReportResult['rows'][number][number];
interface Line {
  cells: readonly Cell[];
  index: number;
}

const show = (value: Cell): string =>
  value === null
    ? 'None'
    : typeof value === 'number'
      ? value.toLocaleString('en-GB')
      : String(value);

/** A measure such as `sum.amount_minor` in words: "Sum of amount minor"; `count` is "Number of rows". */
function measureName(measure: string): string {
  const [fn = '', column] = measure.split('.');
  return column === undefined
    ? 'Number of rows'
    : `${plainName(fn)} of ${column.replaceAll('_', ' ')}`;
}

/** A warehouse report's figures, in the order the response gives them. */
export function WarehouseResult({
  report,
  result,
}: {
  report: ReportDefinition;
  result: ReportResult;
}) {
  const groups: Record<string, string> = report.groupBy;
  const measures: Record<string, string> = report.kind === 'warehouse' ? report.measures : {};
  const columns: Column<Line>[] = result.columns.map(({ itemId, role }, index) => ({
    key: itemId,
    header:
      role === 'group' ? plainName(groups[itemId] ?? '') : measureName(measures[itemId] ?? 'count'),
    rowHeader: index === 0,
    align: role === 'measure' ? 'end' : 'start',
    cell: (line) => show(line.cells[index] ?? null),
  }));
  return (
    <div className="flex flex-col gap-2">
      <DataTable
        caption={`${report.name}: figures`}
        columns={columns}
        rows={result.rows.map((cells, index) => ({ cells, index }))}
        rowKey={(line) => String(line.index)}
        empty={<p>This report found no rows. Check its filters, then run it again.</p>}
      />
      {result.truncated && (
        <p className="text-body text-muted">Only the first 1,000 rows are shown.</p>
      )}
    </div>
  );
}
