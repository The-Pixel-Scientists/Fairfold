// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: how far apart reviewers' scores are on each submission,
// so staff can talk through the wide ones before anyone decides.

import {
  Button,
  FormField,
  Meter,
  PageHeader,
  Panel,
  Select,
  Stats,
  Tag,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { mean, range, round1, rows, sum, WIDE_SPREAD } from './data.ts';
import type { Row } from './data.ts';
import { FilterTabs } from './FilterTabs.tsx';
import { Pager } from './Pager.tsx';
import { SpreadTable } from './SpreadTable.tsx';
import { reviewers } from '../story.ts';

type Filter = 'all' | 'wide';
type Order = 'range' | 'lowest' | 'reference';

const PAGE_SIZE = 10;

const reviewed = rows.filter((row) => row.totals.length >= 2);
const wideCount = reviewed.filter((row) => range(row) >= WIDE_SPREAD).length;
const ranges = reviewed.map(range).sort((a, b) => a - b);
const middle = Math.floor(ranges.length / 2);
const median =
  ranges.length % 2 === 1
    ? (ranges[middle] ?? 0)
    : round1(((ranges[middle - 1] ?? 0) + (ranges[middle] ?? 0)) / 2);
const assigned = sum(rows.map((row) => row.reviews.assigned));
const submitted = sum(rows.map((row) => row.reviews.submitted));
const eligible = rows.filter((row) => row.eligibility === 'Passed').length;

const orders: Readonly<Record<Order, (a: Row, b: Row) => number>> = {
  range: (a, b) => range(b) - range(a) || a.reference.localeCompare(b.reference),
  lowest: (a, b) => mean(a.totals) - mean(b.totals) || a.reference.localeCompare(b.reference),
  reference: (a, b) => a.reference.localeCompare(b.reference),
};

export default function Spread() {
  const [filter, setFilter] = useState<Filter>('all');
  const [order, setOrder] = useState<Order>('range');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['NF-CG-0402']));

  const shown = reviewed
    .filter((row) => filter === 'all' || range(row) >= WIDE_SPREAD)
    .sort(orders[order]);
  const current = Math.min(page, Math.max(1, Math.ceil(shown.length / PAGE_SIZE)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: 'Submissions', to: '/submissions' }, { label: 'Score spread' }]}
        eyebrow={
          <>
            <Tag tone="info">Design preview</Tag>
            <span>Community Grants, Spring 2027</span>
          </>
        }
        title="Score spread"
        description="How far apart reviewers' weighted totals are on each submission. A range of 1.5 or more is flagged: a prompt to talk it through before deciding, not a verdict."
        actions={<Button>Export as CSV</Button>}
      />

      <Stats
        label="Review progress"
        items={[
          {
            label: 'Reviews submitted',
            value: `${String(submitted)} of ${String(assigned)}`,
            detail: `${String(assigned - submitted)} to come, due 24 March 2027`,
          },
          {
            label: 'Two or more reviews',
            value: reviewed.length,
            detail: `Submissions, of ${String(eligible)} eligible`,
          },
          { label: 'Wide spreads', value: wideCount, detail: 'A range of 1.5 or more' },
          { label: 'Median range', value: median.toFixed(1), detail: 'Out of a possible 4' },
        ]}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <FilterTabs<Filter>
            label="Show submissions"
            options={[
              { value: 'all', label: 'All with reviews', count: reviewed.length },
              { value: 'wide', label: 'Wide spread', count: wideCount },
            ]}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setPage(1);
            }}
          />
          <FormField label="Sort by" className="w-full sm:w-64">
            <Select
              value={order}
              onChange={(event) => {
                setOrder(event.currentTarget.value as Order);
                setPage(1);
              }}
            >
              <option value="range">Widest range first</option>
              <option value="lowest">Lowest mean first</option>
              <option value="reference">Reference</option>
            </Select>
          </FormField>
        </div>
        <SpreadTable
          rows={shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)}
          open={open}
          onToggle={(reference) => {
            const next = new Set(open);
            if (!next.delete(reference)) next.add(reference);
            setOpen(next);
          }}
        />
        <Pager
          label="Score spread pages"
          noun="submissions"
          page={current}
          pageSize={PAGE_SIZE}
          total={shown.length}
          onPageChange={setPage}
        />
      </div>

      <Panel title="Reviews done by each reviewer" headingLevel="h2">
        <p className="max-w-prose text-body text-muted">
          How many of the reviews assigned to them each reviewer has submitted. Only staff see this.
        </p>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {reviewers.map((reviewer) => (
            <Meter
              key={reviewer.name}
              label={reviewer.name}
              value={reviewer.submittedBy17March}
              max={reviewer.assigned}
              valueText={`${String(reviewer.submittedBy17March)} of ${String(reviewer.assigned)}`}
              tone={reviewer.submittedBy17March === reviewer.assigned ? 'success' : 'accent'}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}
