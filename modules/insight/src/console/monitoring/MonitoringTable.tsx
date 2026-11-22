// SPDX-License-Identifier: AGPL-3.0-or-later

import { Notice } from '@pixel-scientists/ui';
import { withheldMessage } from '../../contracts/index.ts';
import type { MonitoringCell, MonitoringReport } from '../../contracts/index.ts';
import { plainName } from '../format.ts';
import { MonitoringChart } from './MonitoringChart.tsx';
import { cellText } from './suppressed.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

const th = 'px-3 py-2 text-start font-semibold text-ink';
const td = 'px-3 py-2 text-end tabular-nums';

/** A column is an outcome code, or a stage's id, which has no name here. */
const columnName = (column: string, index: number) =>
  UUID.test(column) ? `Stage ${String(index + 1)}` : plainName(column);

/**
 * An equality monitoring report as the response gives it: a semantic table
 * with each hidden cell in words, a note on why, and a chart of the totals.
 * Nothing is added up, divided or compared here.
 */
export function MonitoringTable({ report, title }: { report: MonitoringReport; title: string }) {
  const { disclosureRule, result } = report;
  const { threshold } = disclosureRule;
  const version =
    disclosureRule.version === null
      ? 'the platform minimum'
      : `version ${String(disclosureRule.version)}`;
  if (result.status === 'withheld') {
    return (
      <Notice tone="info" title="This report is not shown">
        {withheldMessage}
      </Notice>
    );
  }
  const { columns, rows, totals } = result.table;
  const caption = `${title}: ${plainName(report.question)}, disclosure rule ${version}`;
  const cell = (value: MonitoringCell, key: string) => (
    <td key={key} className={td}>
      {cellText(value, threshold)}
    </td>
  );
  return (
    <div className="flex flex-col gap-4">
      <div
        role="region"
        aria-label={`${title}, table`}
        tabIndex={0}
        className="overflow-x-auto rounded-md border border-divider"
      >
        <table className="w-full border-collapse text-body">
          <caption className="px-3 py-2 text-start text-body font-medium text-ink">
            {caption}
          </caption>
          <thead className="bg-sunken">
            <tr>
              <th scope="col" className={th}>
                Answer
              </th>
              {columns.map((column, index) => (
                <th key={column} scope="col" className={`${th} text-end`}>
                  {columnName(column, index)}
                </th>
              ))}
              <th scope="col" className={`${th} text-end`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {rows.map((row) => (
              <tr key={row.option}>
                <th scope="row" className={th}>
                  {plainName(row.option)}
                </th>
                {row.cells.map((value, index) => cell(value, `${row.option}-${String(index)}`))}
                {cell(row.total, `${row.option}-total`)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-divider bg-sunken/60">
              <th scope="row" className={th}>
                All answers
              </th>
              {totals.cells.map((value, index) => cell(value, `total-${String(index)}`))}
              {cell(totals.total, 'total-total')}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="max-w-prose text-body text-muted">
        To keep people anonymous, we do not show groups smaller than {threshold}. Only totals are
        ever shown, and some figures can be hidden as well so that a hidden group cannot be worked
        out from the rest.
      </p>
      <MonitoringChart
        caption={`Total for each answer, ${version}`}
        rows={rows.map((row) => ({ label: plainName(row.option), total: row.total }))}
        threshold={threshold}
      />
    </div>
  );
}
