// SPDX-License-Identifier: AGPL-3.0-or-later

import { readErasureRequest } from '@pixel-scientists/domain/platform/subject-access';
import type { ErasureStatus } from '@pixel-scientists/domain/platform/subject-access';
import {
  Button,
  DataTable,
  EmptyState,
  Link,
  LoadingState,
  Notice,
  PageHeader,
  buttonClassName,
} from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { callApi } from '../../api.ts';
import { SettingsSections } from '../settings/SettingsFrame.tsx';
import { NotFound, useIdParam, usePolled } from './common.tsx';
import { SUBJECT_ACCESS_PATH } from './paths.ts';

const finished = ({ status }: ErasureStatus) => status !== 'queued' && status !== 'running';

const sentence = (code: string) =>
  (code[0]?.toUpperCase() ?? '') + code.slice(1).replaceAll('_', ' ');

interface Count {
  tool: string;
  table: string;
  rows: number;
}

/** `party.person` is the tool "Party" and the table "Person". */
const countsOf = (counts: Record<string, number>): Count[] =>
  Object.entries(counts)
    .map(([name, rows]) => {
      const [tool = '', table = ''] = name.split('.');
      return { tool: sentence(tool), table: sentence(table), rows };
    })
    .sort((a, b) => a.tool.localeCompare(b.tool) || a.table.localeCompare(b.table));

const finalWords: Partial<Record<ErasureStatus['status'], string>> = {
  done: 'The personal data is erased.',
  failed: 'The erasure did not finish. Nothing was erased.',
};

function Status({ request }: { request: ErasureStatus }) {
  switch (request.status) {
    case 'queued':
    case 'running':
      return (
        <Notice
          tone="info"
          title={request.status === 'queued' ? 'The erasure is queued' : 'The erasure is running'}
        >
          <p>This page updates by itself. You can leave it and come back.</p>
        </Notice>
      );
    case 'done':
      return (
        <>
          <Notice tone="success" title="The personal data is erased">
            <p>
              The record is kept and marked erased. The table lists how many rows were changed in
              each tool. It shows no values.
            </p>
          </Notice>
          <DataTable<Count>
            caption="Rows changed by tool and table"
            rows={countsOf(request.counts)}
            rowKey={(row) => `${row.tool}.${row.table}`}
            empty={
              <EmptyState title="No rows needed changing" headingLevel="h3">
                <p>No tool held personal data for this person.</p>
              </EmptyState>
            }
            columns={[
              { key: 'tool', header: 'Tool', rowHeader: true, cell: (row) => row.tool },
              { key: 'table', header: 'Table', cell: (row) => row.table },
              { key: 'rows', header: 'Rows changed', align: 'end', cell: (row) => row.rows },
            ]}
          />
        </>
      );
    case 'failed':
      return (
        <Notice
          tone="danger"
          title="The erasure did not finish"
          action={
            <Link to={SUBJECT_ACCESS_PATH} className={buttonClassName('secondary')}>
              Find a person
            </Link>
          }
        >
          <p>
            Nothing was erased, because the whole erasure is rolled back when any part fails. Find
            the person and ask again. If it fails again, ask your administrator for help.
          </p>
        </Notice>
      );
  }
}

function Erasure({ requestId }: { requestId: string }) {
  const read = useCallback(
    () => callApi(readErasureRequest, { params: { requestId } }),
    [requestId],
  );
  const { state, retry } = usePolled(read, finished);

  if (state.status === 'notFound') return <NotFound />;
  return (
    <div className="flex max-w-3xl flex-col gap-stack">
      <PageHeader title="Erasure" description="One person, erased across every tool." />
      <SettingsSections />
      <p role="status" className="sr-only">
        {state.status === 'ready' && state.changed ? finalWords[state.value.status] : ''}
      </p>
      {state.status === 'loading' && (
        <LoadingState label="Loading this erasure" className="rounded-lg bg-surface" />
      )}
      {state.status === 'failed' && (
        <EmptyState
          title="We could not load this erasure"
          action={<Button onClick={retry}>Try again</Button>}
        >
          <p>{state.message}</p>
        </EmptyState>
      )}
      {state.status === 'ready' && <Status request={state.value} />}
    </div>
  );
}

/** An erasure request: its progress, then what was changed. */
export default function ErasureStatusPage() {
  const requestId = useIdParam('requestId');
  return requestId === null ? <NotFound /> : <Erasure requestId={requestId} />;
}
