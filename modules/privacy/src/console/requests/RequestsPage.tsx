// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Button, DataTable, EmptyState, Link, PageHeader, Select, Tag } from '@pixel-scientists/ui';
import { useState } from 'react';

import { clockStates, listRightsRequests, requestKinds } from '../../contracts/index.ts';
import type { RightsRequestQuery } from '../../contracts/index.ts';
import { useNow, usePages, useZone } from '../hooks.ts';
import { Reading } from '../parts.tsx';
import { viewPath } from '../paths.ts';
import {
  channelWords,
  clockText,
  formatDate,
  identityWords,
  kindWords,
  stateTone,
  stateWords,
  todayIn,
} from '../words.ts';
import { RecordRequestDialog } from './RecordRequestDialog.tsx';

const dueWords = {
  '7': 'Next 7 days',
  '14': 'Next 14 days',
  '30': 'Next 30 days',
  '90': 'Next 90 days',
};

const NO_FILTERS = { kind: '', state: '', dueWithinDays: '' };

/** Each of the three filters is empty or a value the contract checks; the server refuses anything else. */
function queryFor(filters: typeof NO_FILTERS, cursor: string | undefined): RightsRequestQuery {
  return {
    ...(filters.kind === '' ? {} : { kind: filters.kind as RightsRequestQuery['kind'] }),
    ...(filters.state === '' ? {} : { state: filters.state as RightsRequestQuery['state'] }),
    ...(filters.dueWithinDays === '' ? {} : { dueWithinDays: filters.dueWithinDays }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function RequestsPage() {
  const zone = useZone();
  const today = todayIn(useNow(), zone);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [recording, setRecording] = useState(false);

  const { state, loadingMore, moreFailed, more, reload } = usePages(
    (cursor) =>
      call(listRightsRequests, { query: queryFor(filters, cursor) }).then(
        ({ requests, nextCursor }) => ({ items: requests, next: nextCursor }),
      ),
    JSON.stringify(filters),
  );

  const filtered = Object.values(filters).some((value) => value !== '');
  const filter = (name: keyof typeof NO_FILTERS) => (event: { target: { value: string } }) => {
    setFilters({ ...filters, [name]: event.target.value });
  };
  const record = () => {
    setRecording(true);
  };

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Data protection requests"
        description="People asking to see, correct, restrict or erase what you hold about them. Soonest due date first; stopped clocks come last."
        actions={
          <Button variant="primary" onClick={record}>
            Record request
          </Button>
        }
      />
      <form
        role="search"
        aria-label="Filter requests"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Kind
          <Select value={filters.kind} onChange={filter('kind')}>
            <option value="">All kinds</option>
            {requestKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kindWords[kind]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Status
          <Select value={filters.state} onChange={filter('state')}>
            <option value="">All statuses</option>
            {clockStates.map((value) => (
              <option key={value} value={value}>
                {stateWords[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Due within
          <Select value={filters.dueWithinDays} onChange={filter('dueWithinDays')}>
            <option value="">Any time</option>
            {Object.entries(dueWords).map(([days, text]) => (
              <option key={days} value={days}>
                {text}
              </option>
            ))}
          </Select>
        </label>
      </form>
      <Reading state={state} label="Loading requests" retry={reload}>
        {({ items, next }) => (
          <>
            <DataTable
              caption="Data protection requests"
              captionHidden
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'kind',
                  header: 'Request',
                  rowHeader: true,
                  cell: (row) => (
                    <Link
                      to={viewPath('request', row.id)}
                      className="font-medium text-ink underline"
                    >
                      {kindWords[row.kind]}
                    </Link>
                  ),
                },
                { key: 'received', header: 'Received', cell: (row) => formatDate(row.receivedOn) },
                { key: 'channel', header: 'Channel', cell: (row) => channelWords[row.channel] },
                {
                  key: 'identity',
                  header: 'Identity check',
                  cell: (row) => identityWords[row.identityCheck],
                },
                {
                  key: 'clock',
                  header: 'Due date and clock',
                  cell: (row) => (
                    <span className="flex flex-wrap items-center gap-2">
                      <Tag tone={stateTone[row.clock.state]}>{stateWords[row.clock.state]}</Tag>
                      <span>{clockText(row.clock, today)}</span>
                    </span>
                  ),
                },
              ]}
              empty={
                <EmptyState
                  title={filtered ? 'No requests match' : 'No requests yet'}
                  action={
                    filtered ? (
                      <Button
                        onClick={() => {
                          setFilters(NO_FILTERS);
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : (
                      <Button variant="primary" onClick={record}>
                        Record request
                      </Button>
                    )
                  }
                >
                  <p>
                    {filtered
                      ? 'Change or clear the filters to see more.'
                      : 'When someone asks to see or erase their data, record it here to start the clock.'}
                  </p>
                </EmptyState>
              }
            />
            {moreFailed !== null && (
              <p role="alert" className="font-medium text-danger">
                {moreFailed}
              </p>
            )}
            {next !== null && (
              <div>
                <Button onClick={more} aria-disabled={loadingMore || undefined}>
                  {loadingMore ? 'Loading more requests' : 'Show more requests'}
                </Button>
              </div>
            )}
          </>
        )}
      </Reading>
      <RecordRequestDialog
        open={recording}
        onClose={() => {
          setRecording(false);
        }}
        onRecorded={reload}
      />
    </div>
  );
}
