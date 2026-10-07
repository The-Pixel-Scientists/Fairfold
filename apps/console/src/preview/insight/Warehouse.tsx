// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, Panel, SummaryList, Tag } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { Fragment } from 'react';
import type { ReactNode } from 'react';

import { pounds } from '../story.ts';
import { ChartPanel } from './ChartPanel.tsx';
import { ModelDiagram } from './charts/ModelDiagram.tsx';
import { count } from './format.ts';
import { InsightFrame } from './InsightFrame.tsx';
import {
  diagramLinks,
  diagramNodes,
  feedSchedule,
  feedTables,
  lastSync,
  leftOut,
  queryResult,
  sql,
  totalColumns,
  totalRows,
} from './warehouseData.ts';
import type { FeedTable, QueryRow } from './warehouseData.ts';

const code = 'font-mono text-sm';

const tableColumns: readonly Column<FeedTable>[] = [
  {
    key: 'name',
    header: 'Table',
    rowHeader: true,
    cell: (table) => <span className={code}>{table.name}</span>,
  },
  { key: 'rows', header: 'Rows', align: 'end', cell: (table) => count(table.rows) },
  { key: 'columns', header: 'Columns', align: 'end', cell: (table) => table.columns },
  { key: 'belongs', header: 'Belongs to', cell: (table) => table.belongsTo },
];

const columnName = (name: string) => <span className="font-mono">{name}</span>;

const resultColumns: readonly Column<QueryRow>[] = [
  { key: 'theme', header: columnName('theme'), rowHeader: true, cell: (row) => row.theme },
  { key: 'area', header: columnName('area'), cell: (row) => row.area },
  { key: 'grants', header: columnName('grants'), align: 'end', cell: (row) => row.grants },
  {
    key: 'amount',
    header: columnName('amount'),
    align: 'end',
    cell: (row) => pounds(row.amount),
  },
];

/** A table or column name that may wrap after a dot or an underscore, never in the middle of a word. */
function Name({ name }: { name: string }) {
  return name.split(/(?<=[._])/).map((part, index) => (
    <Fragment key={part}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}

const syntax =
  /(--.*$|`[^`]*`|\b(?:SELECT|FROM|JOIN|USING|WHERE|GROUP BY|ORDER BY|LIMIT|AS|COUNT|SUM|DESC)\b)/m;

/** Keywords in bold, names of tables in ink and comments muted, so the query reads without colour. */
function Query() {
  return (
    <pre
      role="region"
      aria-label="Example SQL query"
      tabIndex={0}
      className={`${code} overflow-x-auto rounded-md bg-sunken p-4 leading-6 text-ink`}
    >
      <code>
        {sql.split(syntax).map((part, index) => {
          if (index % 2 === 0) return part;
          if (part.startsWith('--'))
            return (
              <span key={index} className="italic">
                {part}
              </span>
            );
          if (part.startsWith('`'))
            return (
              <span key={index} className="text-muted">
                {part}
              </span>
            );
          return (
            <span key={index} className="font-semibold text-ink">
              {part}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

function Figure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</dd>
    </div>
  );
}

export default function Warehouse() {
  return (
    <InsightFrame
      title="Your data warehouse"
      description="Fairfold Grants keeps a copy of your data in your own warehouse, so you can ask your own questions in the tools you already use."
      actions={
        <>
          <Button variant="quiet">Change destination</Button>
          <Button>Sync now</Button>
        </>
      }
    >
      <Panel title="Feed status" actions={<Tag tone="success">Up to date</Tag>}>
        <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[3fr_2fr]">
          <SummaryList
            items={[
              { term: 'Destination', value: 'Your BigQuery: northfield-analytics' },
              { term: 'Last sync', value: lastSync },
              { term: 'Schedule', value: feedSchedule },
              {
                term: 'Left out',
                value: `${String(leftOut.length)} columns, by their classification`,
              },
            ]}
          />
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] content-center gap-4 border-t border-divider pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12">
            <Figure value={feedTables.length} label="Tables" />
            <Figure value={count(totalRows)} label="Rows" />
            <Figure value={totalColumns} label="Columns" />
          </dl>
        </div>
      </Panel>

      <ChartPanel
        title="How your data fits together"
        takeaway="The same 12 tables and columns, whether you self-host or use the managed service."
        footnote="Each link reads from one to many: the bar is the one and the fork is the many. Application to decision and decision to grant are one to one. A dashed box is shared with Fairfold CRM. Not drawn: form_version and criterion, which belong to round."
        numbers={
          <DataTable
            caption="The 12 tables in the feed"
            captionHidden
            columns={tableColumns}
            rows={feedTables}
            rowKey={(table) => table.name}
          />
        }
      >
        <ModelDiagram
          label="Ten of the twelve tables and how they link: programme to round to application; organisation to application and to person; application to answer, review and decision; review to score; decision to grant."
          nodes={diagramNodes}
          links={diagramLinks}
        />
      </ChartPanel>

      <div className="grid gap-6 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          title="Ask it a question"
          actions={<Button variant="quiet">Copy query</Button>}
        >
          <p className="-mt-2 text-body text-ink">
            Which themes and areas got the most money in Spring 2027? Paste this into BigQuery.
          </p>
          <Query />
          <p className="text-sm text-muted">{`Result: ${String(queryResult.length)} rows in 0.4 seconds`}</p>
          <DataTable
            caption="Spring 2027 grants by theme and area"
            captionHidden
            columns={resultColumns}
            rows={queryResult}
            rowKey={(row) => `${row.theme}-${row.area}`}
          />
        </Panel>

        <Panel className="lg:col-span-5 lg:self-start" title="Left out of the feed">
          <p className="-mt-2 text-body text-ink">
            {`${String(leftOut.length)} of ${String(totalColumns)} columns never leave Fairfold, because of how each one is classified.`}
          </p>
          <ul role="list" className="flex flex-col divide-y divide-divider">
            {leftOut.map((row) => (
              <li key={row.column} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className={`${code} text-ink`}>
                    <Name name={row.column} />
                  </span>
                  <Tag>{row.classification}</Tag>
                </div>
                <p className="text-sm text-muted">{row.why}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </InsightFrame>
  );
}
