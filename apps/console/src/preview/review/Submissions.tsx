// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: every submission to Spring 2027, filtered, sorted and
// selected for bulk actions.

import {
  Button,
  DataTable,
  FieldGroup,
  FormField,
  Input,
  Link,
  PageHeader,
  Select,
  Tag,
} from '@pixel-scientists/ui';
import type { Column, SortState } from '@pixel-scientists/ui';
import { useId, useMemo, useRef, useState } from 'react';

import { Checkbox } from './Checkbox.tsx';
import { FilterTabs } from './FilterTabs.tsx';
import { nextStep, rows, statuses, submittedOn } from './data.ts';
import type { Row } from './data.ts';
import { Pager } from './Pager.tsx';
import { applicationTone } from './tones.ts';
import { pounds } from '../story.ts';
import type { ApplicationStatus } from '../story.ts';

const PAGE_SIZE = 20;

interface Filters {
  query: string;
  eligibility: '' | Row['eligibility'];
  from: string;
  to: string;
  mine: boolean;
}

const noFilters: Filters = { query: '', eligibility: '', from: '', to: '', mine: false };

function matches(item: Row, filters: Filters): boolean {
  const query = filters.query.trim().toLowerCase();
  const from = Number(filters.from.replace(/[^\d]/g, ''));
  const to = Number(filters.to.replace(/[^\d]/g, ''));
  return (
    (query === '' ||
      [item.reference, item.organisation, item.project].some((text) =>
        text.toLowerCase().includes(query),
      )) &&
    (filters.eligibility === '' || item.eligibility === filters.eligibility) &&
    (from === 0 || item.requested >= from) &&
    (to === 0 || item.requested <= to) &&
    (!filters.mine || item.mine)
  );
}

function sortValue(item: Row, key: string): string | number | null {
  switch (key) {
    case 'reference':
      return item.reference;
    case 'project':
      return item.project.toLowerCase();
    case 'requested':
      return item.requested;
    case 'submitted':
      return submittedOn(item);
    case 'score':
      return item.score;
    case 'reviews':
      return item.reviews.assigned === 0 ? null : item.reviews.submitted / item.reviews.assigned;
    default:
      return null;
  }
}

/** Sorts by the column, with rows that have no value last whichever way it runs. */
function sorted(items: readonly Row[], { key, direction }: SortState): Row[] {
  const sign = direction === 'ascending' ? 1 : -1;
  return [...items].sort((a, b) => {
    const [x, y] = [sortValue(a, key), sortValue(b, key)];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order =
      typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
    return sign * order || a.reference.localeCompare(b.reference);
  });
}

export default function Submissions() {
  const [status, setStatus] = useState<'' | ApplicationStatus>('');
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [sort, setSort] = useState<SortState>({ key: 'reference', direction: 'descending' });
  const [page, setPage] = useState(1);
  const search = useRef<HTMLInputElement>(null);
  const selectAllId = useId();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(['NF-CG-0389', 'NF-CG-0430']),
  );

  const others = useMemo(() => rows.filter((item) => matches(item, filters)), [filters]);
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = { all: others.length };
    for (const item of others) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    for (const option of statuses) byStatus[option] ??= 0;
    return byStatus;
  }, [others]);
  const shown = useMemo(
    () => sorted(status === '' ? others : others.filter((item) => item.status === status), sort),
    [others, status, sort],
  );

  const lastPage = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, lastPage);
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const onPage = pageRows.filter((item) => selected.has(item.reference)).length;
  const filtering = status !== '' || JSON.stringify(filters) !== JSON.stringify(noFilters);

  function change(next: Partial<Filters>) {
    setFilters({ ...filters, ...next });
    setPage(1);
  }

  function toggle(references: readonly string[], on: boolean) {
    const next = new Set(selected);
    for (const reference of references) {
      if (on) next.add(reference);
      else next.delete(reference);
    }
    setSelected(next);
  }

  function clearFilters() {
    setStatus('');
    setFilters(noFilters);
    setPage(1);
    search.current?.focus();
  }

  const columns: readonly Column<Row>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          id={selectAllId}
          label="Select every submission on this page"
          labelHidden
          checked={pageRows.length > 0 && onPage === pageRows.length}
          indeterminate={onPage > 0 && onPage < pageRows.length}
          onCheckedChange={(on) => {
            toggle(
              pageRows.map((item) => item.reference),
              on,
            );
          }}
        />
      ),
      cell: (item) => (
        <Checkbox
          label={`Select ${item.reference}, ${item.project}`}
          labelHidden
          checked={selected.has(item.reference)}
          onCheckedChange={(on) => {
            toggle([item.reference], on);
          }}
        />
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      sortable: true,
      cell: (item) => <span className="text-muted tabular-nums">{item.reference}</span>,
    },
    {
      key: 'project',
      header: 'Project and organisation',
      sortable: true,
      rowHeader: true,
      cell: (item) => (
        <div className="flex flex-col">
          <Link
            to={`/submissions/${item.reference}`}
            className="font-medium text-ink no-underline hover:text-ink hover:underline"
          >
            {item.project}
          </Link>
          <span className="text-sm font-normal text-muted">{item.organisation}</span>
        </div>
      ),
    },
    {
      key: 'requested',
      header: 'Requested',
      align: 'end',
      sortable: true,
      cell: (item) => pounds(item.requested),
    },
    {
      key: 'submitted',
      header: 'Date submitted',
      sortable: true,
      cell: (item) => item.submitted,
    },
    {
      key: 'status',
      header: 'Status and next step',
      cell: (item) => (
        <div className="flex flex-col items-start gap-1">
          <Tag tone={applicationTone[item.status]}>{item.status}</Tag>
          <span className="text-sm text-muted">{nextStep(item)}</span>
        </div>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      align: 'end',
      sortable: true,
      cell: (item) =>
        item.score === null ? (
          <span className="text-muted">
            {item.status === 'Ineligible' ? 'Not reviewed' : 'No reviews yet'}
          </span>
        ) : (
          <span className="font-medium">{item.score.toFixed(1)}</span>
        ),
    },
    {
      key: 'reviews',
      header: 'Reviews',
      align: 'end',
      sortable: true,
      cell: (item) =>
        item.reviews.assigned === 0 ? (
          <span className="text-muted">None assigned</span>
        ) : (
          `${String(item.reviews.submitted)} of ${String(item.reviews.assigned)}`
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          <>
            <Tag tone="info">Design preview</Tag>
            <span>Community Grants, Spring 2027</span>
            <Tag tone="info">Assessing</Tag>
          </>
        }
        title="Submissions"
        description="Everything received for this round, where each application stands and what needs doing next."
      />

      <FilterTabs
        label="Show submissions with a status"
        options={[
          { value: '', label: 'All submissions', count: counts['all'] ?? 0 },
          ...statuses.map((option) => ({
            value: option,
            label: option,
            count: counts[option] ?? 0,
          })),
        ]}
        value={status}
        onChange={(next) => {
          setStatus(next);
          setPage(1);
        }}
      />

      <form
        role="search"
        aria-label="Filter submissions"
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="grid items-end gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_minmax(9rem,1fr)_minmax(16rem,2fr)_auto]"
      >
        <FormField label="Search">
          <Input
            ref={search}
            type="search"
            value={filters.query}
            placeholder="Reference, project or organisation"
            onChange={(event) => {
              change({ query: event.currentTarget.value });
            }}
          />
        </FormField>
        <FormField label="Eligibility">
          <Select
            value={filters.eligibility}
            onChange={(event) => {
              change({ eligibility: event.currentTarget.value as Filters['eligibility'] });
            }}
          >
            <option value="">Any</option>
            <option value="Passed">Passed</option>
            <option value="Failed">Failed</option>
          </Select>
        </FormField>
        <FieldGroup
          legend="Amount requested (£)"
          hint="This round: £1,000 to £25,000"
          className="sm:col-span-2 xl:col-span-1"
        >
          <div className="grid grid-cols-2 gap-3">
            <FormField label="From">
              <Input
                inputMode="numeric"
                value={filters.from}
                onChange={(event) => {
                  change({ from: event.currentTarget.value });
                }}
              />
            </FormField>
            <FormField label="To">
              <Input
                inputMode="numeric"
                value={filters.to}
                onChange={(event) => {
                  change({ to: event.currentTarget.value });
                }}
              />
            </FormField>
          </div>
        </FieldGroup>
        <div className="flex min-h-control items-center gap-3 sm:col-span-2 xl:col-span-1">
          <Checkbox
            label="Assigned to me"
            checked={filters.mine}
            onCheckedChange={(mine) => {
              change({ mine });
            }}
          />
          {filtering && (
            <Button variant="quiet" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </form>

      <div
        role="group"
        aria-label="Bulk actions"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-divider bg-sunken/60 px-3 py-2"
      >
        <p aria-live="polite" className="text-body text-muted">
          {selected.size === 0 ? (
            'Select submissions to act on several at once.'
          ) : (
            <>
              <span className="font-semibold text-ink">{selected.size} selected</span>
              {` of ${String(rows.length)} submissions`}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={selected.size === 0}>Assign reviewers</Button>
          <Button disabled={selected.size === 0}>Move to stage</Button>
          <Button disabled={selected.size === 0}>Export selected</Button>
        </div>
        {selected.size > 0 && (
          <Button
            variant="quiet"
            className="sm:ml-auto"
            onClick={() => {
              setSelected(new Set());
              document.getElementById(selectAllId)?.focus();
            }}
          >
            Clear selection
          </Button>
        )}
      </div>

      <DataTable
        caption="Submissions for the Spring 2027 round"
        captionHidden
        columns={columns}
        rows={pageRows}
        rowKey={(item) => item.reference}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        empty={
          <div className="flex flex-col items-start gap-2">
            <p className="font-medium text-ink">No submissions match these filters</p>
            <p className="text-muted">
              {`Try a different search, or clear the filters to see all ${String(rows.length)} submissions.`}
            </p>
            <Button onClick={clearFilters}>Clear filters</Button>
          </div>
        }
      />

      <Pager
        label="Submissions pages"
        noun="submissions"
        page={current}
        pageSize={PAGE_SIZE}
        total={shown.length}
        onPageChange={setPage}
      />
    </div>
  );
}
