// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { DataTable, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { getResponseTotals } from '../../contracts/index.ts';
import type { Filters } from './filters.ts';
import { queryOf } from './filters.ts';

type Row = { label: string; count: number };

const columns: readonly Column<Row>[] = [
  { key: 'label', header: 'Responses', rowHeader: true, cell: (row) => row.label },
  { key: 'count', header: 'Count', align: 'end', cell: (row) => String(row.count) },
];

async function load(key: string): Promise<Row[]> {
  const { formId, filters } = JSON.parse(key) as { formId: string; filters: Filters };
  const totals = await call(getResponseTotals, { params: { formId }, query: queryOf(filters) });
  return [
    { label: 'Received', count: totals.received },
    { label: 'Signed in', count: totals.signedIn },
    { label: 'Anonymous', count: totals.anonymous },
    { label: 'Sent without the browser check', count: totals.sentWithoutCheck },
    { label: 'Marked as spam', count: totals.spam },
  ];
}

/** How many responses match the filters. Counts only: no answer is ever counted here. */
export function Totals({ formId, filters }: { formId: string; filters: Filters }) {
  const { state, retry } = useLoad(load, JSON.stringify({ formId, filters }));
  return (
    <WhenLoaded state={state} label="Loading totals" retry={retry}>
      {(rows) => (
        <DataTable
          caption="Response totals for the filters chosen"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.label}
        />
      )}
    </WhenLoaded>
  );
}
