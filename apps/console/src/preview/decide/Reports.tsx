// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: Reports and data. Taking data out in open formats, with
// personal fields left out by their classification (rule 5), and a history
// of every export (rule 4).

import {
  Button,
  DataTable,
  FormField,
  Link,
  PageHeader,
  Panel,
  Select,
  SummaryList,
  Tag,
} from '@pixel-scientists/ui';
import type { Column, SortState } from '@pixel-scientists/ui';
import { useState } from 'react';

import {
  feedSchedule,
  feedTables,
  lastSync,
  leftOut as leftOutColumns,
  totalRows,
} from '../insight/warehouseData.ts';
import type { FeedTable } from '../insight/warehouseData.ts';
import { figures } from '../setup/data.ts';
import { pounds } from '../story.ts';
import { awards, awardedTotal } from './decisions-data.ts';
import { formatWhen } from './format.ts';
import { Eyebrow, Icon } from './parts.tsx';

const { received, eligible } = figures;
const applicationCount = (count: number) => `${String(count)} applications`;
const grantCount = `${String(awards.length)} grants`;

/** The time on screen, 2 April 2027, when the person syncs the warehouse feed. */
const syncedAt = '9:20am';

interface ExportRecord {
  id: number;
  /** `2027-04-02T09:14`, so the rows sort as text. */
  at: string;
  name: string;
  format: 'JSON' | 'CSV';
  contents: string;
  by: string;
}

const history: readonly ExportRecord[] = [
  {
    id: 1,
    at: '2027-04-02T09:14',
    name: '360Giving file, Spring 2027',
    format: 'CSV',
    contents: grantCount,
    by: 'Ada Morgan',
  },
  {
    id: 2,
    at: '2027-04-02T09:14',
    name: '360Giving file, Spring 2027',
    format: 'JSON',
    contents: grantCount,
    by: 'Ada Morgan',
  },
  {
    id: 3,
    at: '2027-04-01T16:40',
    name: 'Applications, Spring 2027',
    format: 'CSV',
    contents: applicationCount(eligible),
    by: 'Marcus Bell',
  },
  {
    id: 4,
    at: '2027-03-04T17:20',
    name: 'Applications, Spring 2027',
    format: 'CSV',
    contents: applicationCount(received),
    by: 'Ada Morgan',
  },
  {
    id: 5,
    at: '2027-01-18T11:05',
    name: '360Giving file, Autumn 2026',
    format: 'JSON',
    contents: '17 grants',
    by: 'Ada Morgan',
  },
  {
    id: 6,
    at: '2027-01-18T11:05',
    name: '360Giving file, Autumn 2026',
    format: 'CSV',
    contents: '17 grants',
    by: 'Ada Morgan',
  },
  {
    id: 7,
    at: '2026-12-14T10:32',
    name: 'Applications, Autumn 2026',
    format: 'CSV',
    contents: '52 applications',
    by: 'Marcus Bell',
  },
];

const included = [
  'Reference',
  'Programme',
  'Round',
  'Organisation',
  'Charity number',
  'Project',
  'Theme',
  'Area',
  'Amount requested',
  'Amount awarded',
  'Status',
  'Submitted',
  'Decision released',
  'Mean score',
];

const leftOut = [
  ['Contact name', 'Personal'],
  ['Contact email', 'Personal'],
  ['Contact phone', 'Personal'],
  ['Bank details', 'Personal'],
  ['Equality monitoring answers', 'Special category'],
  ['Internal notes', 'Personal'],
] as const;

const scopes = [
  { value: 'all', label: `All ${String(received)} received`, rows: applicationCount(received) },
  { value: 'eligible', label: `${String(eligible)} eligible`, rows: applicationCount(eligible) },
  {
    value: 'awarded',
    label: `${String(awards.length)} awarded`,
    rows: applicationCount(awards.length),
  },
];

/** How many of a table's columns the feed leaves out, from the same classification list the data model page shows. */
const leftOutCount = (table: FeedTable) =>
  leftOutColumns.filter((item) => item.column.startsWith(`${table.name}.`)).length;

const tableColumns: readonly Column<FeedTable>[] = [
  {
    key: 'name',
    header: 'Table',
    rowHeader: true,
    cell: (row) => <span className="font-mono text-sm">{row.name}</span>,
  },
  { key: 'rows', header: 'Rows', align: 'end', cell: (row) => row.rows.toLocaleString('en-GB') },
  {
    key: 'leftOut',
    header: 'Columns left out',
    align: 'end',
    cell: (row) =>
      leftOutCount(row) === 0 ? <span className="text-muted">None</span> : leftOutCount(row),
  },
];

const historyColumns: readonly Column<ExportRecord>[] = [
  {
    key: 'at',
    header: 'When',
    sortable: true,
    rowHeader: true,
    cell: (row) => formatWhen(row.at),
  },
  { key: 'name', header: 'Export', cell: (row) => row.name },
  { key: 'format', header: 'Format', cell: (row) => row.format },
  { key: 'contents', header: 'Contents', cell: (row) => row.contents },
  { key: 'by', header: 'Made by', cell: (row) => row.by },
];

export default function Reports() {
  const [exports, setExports] = useState<readonly ExportRecord[]>(history);
  const [sort, setSort] = useState<SortState>({ key: 'at', direction: 'descending' });
  const [scope, setScope] = useState(scopes[1]?.value ?? 'eligible');
  const [message, setMessage] = useState('');
  const [syncedNow, setSyncedNow] = useState(false);

  function download(name: string, format: ExportRecord['format'], contents: string) {
    const minute = String(Math.min(20 + exports.length - history.length, 59)).padStart(2, '0');
    setExports((current) => [
      {
        id: current.length + 1,
        at: `2027-04-02T09:${minute}`,
        name,
        format,
        contents,
        by: 'Ada Morgan',
      },
      ...current,
    ]);
    setMessage(`${name} (${format}) downloaded. It is in the export history below.`);
  }

  const rows = [...exports].sort(
    (a, b) => (sort.direction === 'ascending' ? 1 : -1) * (a.at.localeCompare(b.at) || a.id - b.id),
  );
  const chosen = scopes.find((item) => item.value === scope) ?? scopes[0];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Eyebrow>
            <span>Northfield Foundation</span>
          </Eyebrow>
        }
        title="Reports and data"
        description="Take your data out in open formats. Every export is recorded in the audit log, with who made it and when."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="360Giving export" className="h-full">
          <SummaryList
            items={[
              {
                term: 'Validation',
                value: (
                  <>
                    <Tag tone="success">Valid</Tag> against the 360Giving Data Standard
                  </>
                ),
              },
              {
                term: 'Last file',
                value: <span className="break-all">northfield-spring-2027-360giving</span>,
              },
              { term: 'Made', value: '2 April 2027, 9:14am, by Ada Morgan' },
              { term: 'Grants', value: awards.length },
              { term: 'Total awarded', value: pounds(awardedTotal) },
              { term: 'Standard', value: '360Giving Data Standard, version 1.4' },
              { term: 'Licence', value: 'Creative Commons Attribution 4.0' },
            ]}
          />
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              onClick={() => {
                download('360Giving file, Spring 2027', 'JSON', grantCount);
              }}
            >
              <span>
                Download <span className="sr-only">360Giving </span>JSON
              </span>
            </Button>
            <Button
              onClick={() => {
                download('360Giving file, Spring 2027', 'CSV', grantCount);
              }}
            >
              <span>
                Download <span className="sr-only">360Giving </span>CSV
              </span>
            </Button>
          </div>
        </Panel>

        <Panel title="Warehouse feed" className="h-full">
          <SummaryList
            items={[
              { term: 'Status', value: <Tag tone="success">Up to date</Tag> },
              { term: 'Destination', value: 'Your BigQuery: northfield-analytics' },
              {
                term: 'Last sync',
                value: syncedNow ? syncedAt : lastSync,
              },
              { term: 'Schedule', value: feedSchedule },
              {
                term: 'Contents',
                value: `${String(feedTables.length)} tables, ${totalRows.toLocaleString('en-GB')} rows`,
              },
              {
                term: 'Left out',
                value: `${String(leftOutColumns.length)} columns, by classification`,
              },
            ]}
          />
          <details className="group">
            <summary className="inline-flex min-h-target cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="size-3.5 text-muted transition-transform duration-(--motion-fast) group-open:rotate-90"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 3.5 4.5 4.5L6 12.5" />
              </svg>
              Show the {feedTables.length} tables
            </summary>
            <div className="pt-2">
              <DataTable
                caption="Tables in the warehouse feed"
                captionHidden
                columns={tableColumns}
                rows={feedTables}
                rowKey={(row) => row.name}
              />
            </div>
          </details>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            <Button
              onClick={() => {
                setSyncedNow(true);
                setMessage(`Warehouse feed synced at ${syncedAt}.`);
              }}
            >
              Sync now
            </Button>
            <Link to="/insight/warehouse">See the data model</Link>
          </div>
        </Panel>
      </div>

      <Panel title="CSV export">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <FormField label="Applications to include" className="w-full max-w-72">
            <Select
              value={scope}
              onChange={(event) => {
                setScope(event.currentTarget.value);
              }}
            >
              {scopes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </FormField>
          <Button
            onClick={() => {
              download('Applications, Spring 2027', 'CSV', chosen?.rows ?? '');
            }}
          >
            Download applications CSV
          </Button>
        </div>

        <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="in-file" className="flex flex-col gap-3">
            <h3 id="in-file" className="text-body font-semibold text-ink">
              In the file ({included.length} columns)
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {included.map((column) => (
                <li key={column} className="rounded-md bg-sunken px-2 py-1 text-sm text-ink">
                  {column}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="left-out" className="flex flex-col gap-3">
            <h3 id="left-out" className="text-body font-semibold text-ink">
              Left out by classification ({leftOut.length})
            </h3>
            <ul className="flex flex-col divide-y divide-divider text-body">
              {leftOut.map(([field, level]) => (
                <li
                  key={field}
                  className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                >
                  {field}
                  <Tag>{level}</Tag>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="flex items-start gap-2 border-t border-divider pt-3 text-sm text-muted">
          <Icon name="lock" className="mt-0.5" />
          <span>
            <span className="font-medium text-ink">Personal fields never leave in an export.</span>{' '}
            Every field has a sensitivity level in the field classification map, and exports and the
            warehouse feed read it. To get a person’s own data, use a subject access request.
          </span>
        </p>
      </Panel>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="history" className="text-lg font-semibold tracking-tight text-ink">
            Export history
          </h2>
          <p role="status" className="flex items-center gap-1.5 text-sm text-muted">
            {message !== '' && <Icon name="check" className="text-success" />}
            {message === '' ? 'Every export is audited.' : message}
          </p>
        </div>
        <DataTable
          caption="Exports made from Fairfold Grants"
          captionHidden
          columns={historyColumns}
          rows={rows}
          rowKey={(row) => String(row.id)}
          sort={sort}
          onSortChange={setSort}
        />
      </section>
    </div>
  );
}
