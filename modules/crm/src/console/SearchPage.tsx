// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  DataTable,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Link,
  PageHeader,
  Select,
  Tag,
  asProblem,
  formText,
  useSubmit,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useLayoutEffect, useState } from 'react';

import type { PartySearchPage } from '../contracts/index.ts';
import { search } from './loaders.ts';
import { organisationPath, personPath } from './paths.ts';
import { buildRequest, forget, noFilters, recall, remember } from './search.ts';
import type { Filters } from './search.ts';
import { kindWords, statusWords, verificationWords } from './words.ts';

type Result = PartySearchPage['results'][number];

const columns: readonly Column<Result>[] = [
  {
    key: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (row) =>
      row.status === 'erased' ? (
        'Erased person'
      ) : (
        <Link to={row.kind === 'organisation' ? organisationPath(row.id) : personPath(row.id)}>
          {row.label}
        </Link>
      ),
  },
  { key: 'kind', header: 'Kind', cell: (row) => kindWords[row.kind] },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <Tag tone={row.status === 'active' ? 'success' : 'neutral'}>{statusWords[row.status]}</Tag>
    ),
  },
  {
    key: 'verification',
    header: 'Identifier',
    cell: (row) =>
      row.kind === 'person' || row.status === 'erased' ? (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">Not applicable</span>
        </>
      ) : (
        <Tag tone={row.verification === 'verified' ? 'success' : 'neutral'}>
          {verificationWords[row.verification]}
        </Tag>
      ),
  },
];

/** How many results the list holds, said once each time it changes. */
function countWords(shown: number, more: boolean): string {
  const noun = shown === 1 && !more ? 'result' : 'results';
  return `${String(shown)}${more ? ' or more' : ''} ${noun}`;
}

/** Searches organisations and people. The term is sent in the request body only. */
export default function SearchPage() {
  const [saved] = useState(recall);
  const [filters, setFilters] = useState<Filters>(saved?.filters ?? noFilters);
  const [results, setResults] = useState<Result[] | null>(saved?.results.slice() ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(saved?.nextCursor ?? null);
  const [moreProblem, setMoreProblem] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useLayoutEffect(() => {
    if (saved !== null) window.scrollTo(0, saved.scrollY);
  }, [saved]);

  const form = useSubmit(['term'], async (data) => {
    const next: Filters = {
      term: formText(data, 'term'),
      kind: formText(data, 'kind') as Filters['kind'],
      status: formText(data, 'status') as Filters['status'],
      verification: formText(data, 'verification') as Filters['verification'],
    };
    const page = await search(buildRequest(next));
    setFilters(next);
    setResults(page.results);
    setNextCursor(page.nextCursor);
    setMoreProblem(null);
    forget();
  });

  async function showMore() {
    if (nextCursor === null || results === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await search(buildRequest(filters, nextCursor));
      setResults([...results, ...page.results]);
      setNextCursor(page.nextCursor);
      setMoreProblem(null);
    } catch (error) {
      setMoreProblem(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Organisations and people"
        description="Search the organisations and people your funder works with. Open a record to see its identifiers, contacts and history."
      />
      <form
        role="search"
        aria-label="Search organisations and people"
        noValidate
        onSubmit={form.onSubmit}
        className="flex flex-col gap-3"
      >
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <FormField
            label="Search"
            hint="A name, an email address or a charity or company number."
            error={form.errorFor('term')}
            id="term"
            className="w-full max-w-sm"
          >
            <Input name="term" type="search" autoComplete="off" defaultValue={filters.term} />
          </FormField>
          <FormField label="Kind">
            <Select name="kind" defaultValue={filters.kind}>
              <option value="any">Organisations and people</option>
              <option value="organisation">Organisations</option>
              <option value="person">People</option>
            </Select>
          </FormField>
          <FormField label="Status">
            <Select name="status" defaultValue={filters.status}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="merged">Merged</option>
              <option value="erased">Erased</option>
              <option value="any">Any status</option>
            </Select>
          </FormField>
          <FormField label="Identifier">
            <Select name="verification" defaultValue={filters.verification}>
              <option value="any">Any</option>
              <option value="verified">Verified</option>
              <option value="claimed">Unverified</option>
              <option value="none">No identifier</option>
            </Select>
          </FormField>
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Search records
          </Button>
        </div>
      </form>
      <p role="status" className="text-sm text-muted">
        {results === null ? '' : countWords(results.length, nextCursor !== null)}
      </p>
      {results === null ? (
        <EmptyState title="Search to find a record">
          <p>Enter at least 2 characters of a name, email address or number, then search.</p>
        </EmptyState>
      ) : (
        <div
          onClickCapture={() => {
            remember({ filters, results, nextCursor, scrollY: window.scrollY });
          }}
        >
          <DataTable
            caption="Search results"
            captionHidden
            columns={columns}
            rows={results}
            rowKey={(row) => row.id}
            empty={
              <div className="flex flex-col items-start gap-1">
                <p className="font-medium text-ink">No records match your search</p>
                <p className="text-muted">
                  Check the spelling, search by number or email address, or choose any status.
                </p>
              </div>
            }
          />
        </div>
      )}
      {moreProblem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {moreProblem}
        </p>
      )}
      {nextCursor !== null && (
        <div>
          <Button onClick={() => void showMore()} aria-disabled={loadingMore || undefined}>
            Show more results
          </Button>
        </div>
      )}
    </div>
  );
}
