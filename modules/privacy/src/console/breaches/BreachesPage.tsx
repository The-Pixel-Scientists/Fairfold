// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Button, DataTable, EmptyState, Link, PageHeader } from '@pixel-scientists/ui';
import { useState } from 'react';

import { listBreaches } from '../../contracts/index.ts';
import { useNow, usePages, useZone } from '../hooks.ts';
import { Reading } from '../parts.tsx';
import { viewPath } from '../paths.ts';
import { breachClockText, categoryWords, formatMoment, riskWords } from '../words.ts';
import { RecordBreachDialog } from './RecordBreachDialog.tsx';

const load = (cursor: string | undefined) =>
  call(listBreaches, { query: cursor === undefined ? {} : { cursor } }).then(
    ({ breaches, nextCursor }) => ({ items: breaches, next: nextCursor }),
  );

export function BreachesPage() {
  const zone = useZone();
  const now = useNow();
  const { state, loadingMore, moreFailed, more, reload } = usePages(load, '');
  const [recording, setRecording] = useState(false);
  const record = () => {
    setRecording(true);
  };

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Personal data breaches"
        description="The log of breaches, newest first. The ICO must be told within 72 hours of becoming aware, when the breach is a risk to people."
        actions={
          <Button variant="primary" onClick={record}>
            Record breach
          </Button>
        }
      />
      <Reading state={state} label="Loading breaches" retry={reload}>
        {({ items, next }) => (
          <>
            <DataTable
              caption="Personal data breaches"
              captionHidden
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'aware',
                  header: 'Became aware',
                  rowHeader: true,
                  cell: (row) => (
                    <Link
                      to={viewPath('breach', row.id)}
                      className="font-medium text-ink underline"
                    >
                      {formatMoment(row.becameAwareAt, zone)}
                    </Link>
                  ),
                },
                {
                  key: 'data',
                  header: 'Data involved',
                  cell: (row) => (
                    <span className="whitespace-normal">
                      {row.dataCategories.map((category) => categoryWords[category]).join(', ')}
                      {row.specialCategory ? ' (includes special category data)' : ''}
                    </span>
                  ),
                },
                {
                  key: 'risk',
                  header: 'Risk to people',
                  cell: (row) =>
                    row.riskLevel === null ? 'Not assessed' : riskWords[row.riskLevel],
                },
                {
                  key: 'ico',
                  header: 'ICO',
                  cell: (row) => (row.icoNotified ? 'Told' : 'Not told'),
                },
                {
                  key: 'clock',
                  header: '72-hour clock',
                  cell: (row) =>
                    breachClockText(
                      {
                        becameAwareAt: row.becameAwareAt,
                        icoNotified: row.icoNotified,
                        late: row.clock.late,
                      },
                      now,
                      zone,
                    ),
                },
              ]}
              empty={
                <EmptyState
                  title="No breaches recorded"
                  action={
                    <Button variant="primary" onClick={record}>
                      Record breach
                    </Button>
                  }
                >
                  <p>
                    Record a breach as soon as you become aware of it, even before you know the
                    detail. The 72-hour clock starts from that time.
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
                  {loadingMore ? 'Loading more breaches' : 'Show more breaches'}
                </Button>
              </div>
            )}
          </>
        )}
      </Reading>
      <RecordBreachDialog
        open={recording}
        onClose={() => {
          setRecording(false);
        }}
        onRecorded={reload}
      />
    </div>
  );
}
