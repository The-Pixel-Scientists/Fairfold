// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  Button,
  buttonClassName,
} from '@pixel-scientists/ui';

import { listDpias } from '../../contracts/index.ts';
import { usePages, useZone } from '../hooks.ts';
import { Reading } from '../parts.tsx';
import { viewPath } from '../paths.ts';
import { dpiaWords, formatDate, todayIn } from '../words.ts';

const load = (cursor: string | undefined) =>
  call(listDpias, { query: cursor === undefined ? {} : { cursor } }).then(
    ({ dpias, nextCursor }) => ({ items: dpias, next: nextCursor }),
  );

export function DpiasPage() {
  const zone = useZone();
  const { state, loadingMore, moreFailed, more, reload } = usePages(load, '');
  const start = (
    <Link to={viewPath('dpia', 'new')} className={buttonClassName('primary')}>
      Start DPIA
    </Link>
  );
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Data protection impact assessments"
        description="Assess the risk to people before you start processing that is likely to be high risk."
        actions={start}
      />
      <Reading state={state} label="Loading DPIAs" retry={reload}>
        {({ items, next }) => (
          <>
            <DataTable
              caption="Data protection impact assessments"
              captionHidden
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'title',
                  header: 'Title',
                  rowHeader: true,
                  cell: (row) => (
                    <Link to={viewPath('dpia', row.id)} className="font-medium text-ink underline">
                      <span className="whitespace-normal">{row.title}</span>
                    </Link>
                  ),
                },
                { key: 'status', header: 'Status', cell: (row) => dpiaWords[row.status] },
                {
                  key: 'review',
                  header: 'Review on',
                  cell: (row) => (row.reviewOn === null ? 'Not set' : formatDate(row.reviewOn)),
                },
                {
                  key: 'updated',
                  header: 'Last changed',
                  cell: (row) => formatDate(todayIn(row.updatedAt, zone)),
                },
              ]}
              empty={
                <EmptyState title="No DPIAs yet" action={start}>
                  <p>
                    Start one when a new project, tool or change uses personal data in a way that
                    could be high risk.
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
                  {loadingMore ? 'Loading more DPIAs' : 'Show more DPIAs'}
                </Button>
              </div>
            )}
          </>
        )}
      </Reading>
    </div>
  );
}
