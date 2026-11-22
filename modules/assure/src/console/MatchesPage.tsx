// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  DataTable,
  EmptyState,
  FormField,
  Link,
  PageHeader,
  Select,
  Tag,
  WhenLoaded,
  asProblem,
  useLoad,
  useNavigate,
} from '@pixel-scientists/ui';
import type { Column, SortState } from '@pixel-scientists/ui';
import { useState } from 'react';

import { matchStatuses } from '../contracts/index.ts';
import type { MatchQuery } from '../contracts/index.ts';
import { Gate } from './Gate.tsx';
import { loadMatches } from './loaders.ts';
import { matchPath } from './paths.ts';
import { age, entryKindWords, formatDay, nameSourceWords, percent, statusLabel } from './words.ts';

type Page = Awaited<ReturnType<typeof loadMatches>>;
type Row = Page['matches'][number];

/** The status chosen last, kept while the member is in the console so Back finds the same list. */
let remembered: MatchQuery['status'] = 'open';

const STATUS_FILTER_ID = 'match-status';

function StatusTag({ status }: { status: Row['status'] }) {
  return (
    <Tag tone={status === 'open' ? 'info' : status === 'needs_information' ? 'warning' : 'neutral'}>
      {statusLabel(status)}
    </Tag>
  );
}

const columns: readonly Column<Row>[] = [
  {
    key: 'raisedAt',
    header: 'Raised',
    rowHeader: true,
    sortable: true,
    cell: (row) => <Link to={matchPath(row.id)}>{formatDay(row.raisedAt.slice(0, 10))}</Link>,
  },
  { key: 'age', header: 'Waiting', cell: (row) => age(row.raisedAt) },
  { key: 'source', header: 'Name from', cell: (row) => nameSourceWords[row.nameSource] },
  { key: 'kind', header: 'Listed as', cell: (row) => entryKindWords[row.entryKind] },
  {
    key: 'similarity',
    header: 'Similarity',
    align: 'end',
    sortable: true,
    cell: (row) => percent(row.similarity),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusTag status={row.status} /> },
];

function order(rows: readonly Row[], sort: SortState): Row[] {
  const sign = sort.direction === 'ascending' ? 1 : -1;
  const value = (row: Row) =>
    sort.key === 'similarity' ? row.similarity : Date.parse(row.raisedAt);
  return [...rows].sort((a, b) => sign * (value(a) - value(b)));
}

function Table({ first, status }: { first: Page; status: MatchQuery['status'] }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<readonly Row[]>(first.matches);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [sort, setSort] = useState<SortState>({ key: 'raisedAt', direction: 'ascending' });
  const [failed, setFailed] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  function more() {
    if (cursor === null) return;
    setFailed(null);
    loadMatches({ ...(status && { status }), cursor }).then(
      (next) => {
        setRows((current) => [...current, ...next.matches]);
        setCursor(next.nextCursor);
        setSaid(`Showing ${String(rows.length + next.matches.length)} matches.`);
      },
      (error: unknown) => {
        setFailed(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
      },
    );
  }

  return (
    <>
      <DataTable
        caption="Possible matches"
        captionHidden
        columns={columns}
        rows={order(rows, sort)}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
        onOpenRow={(row) => {
          navigate(matchPath(row.id));
        }}
        empty={
          <EmptyState title="No matches to review" headingLevel="h2">
            <p>
              When a screening run finds a name that looks like a listed one, it appears here for a
              member to review.
            </p>
          </EmptyState>
        }
      />
      <p role="status" className="sr-only">
        {said}
      </p>
      {failed !== null && (
        <p role="alert" className="text-danger">
          {failed}
        </p>
      )}
      {cursor !== null && (
        <div>
          <Button onClick={more}>Show more matches</Button>
        </div>
      )}
    </>
  );
}

const readMatches = (chosen: MatchQuery['status']) => loadMatches(chosen ? { status: chosen } : {});

/** Remounts when the filter changes, so it never shows one status's rows under another. */
function List({ status }: { status: MatchQuery['status'] }) {
  const { state, retry } = useLoad(readMatches, status);
  return (
    <WhenLoaded state={state} label="Loading possible matches" retry={retry}>
      {(page) => <Table first={page} status={status} />}
    </WhenLoaded>
  );
}

function Queue() {
  const [status, setStatus] = useState<MatchQuery['status']>(remembered);
  return (
    <>
      <PageHeader
        title="Possible matches"
        description="Names that look like a listed name. Each is advisory: a member reviews it and decides."
      />
      <FormField label="Show" id={STATUS_FILTER_ID}>
        <Select
          value={status ?? ''}
          onChange={(event) => {
            const next = matchStatuses.find((value) => value === event.target.value);
            remembered = next;
            setStatus(next);
          }}
        >
          <option value="open">Open</option>
          <option value="not_a_match">Not a match</option>
          <option value="needs_information">Needs more information</option>
          <option value="confirmed">Confirmed match</option>
          <option value="">All</option>
        </Select>
      </FormField>
      <List key={status ?? 'all'} status={status} />
    </>
  );
}

export default function MatchesPage() {
  return (
    <Gate permission="assure.screening.read">
      <Queue />
    </Gate>
  );
}
