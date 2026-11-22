// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, Link, Notice, Panel, WhenLoaded, useCan, useLoad } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { DuplicateFlag } from '../../contracts/index.ts';
import { loadFlags } from '../loaders.ts';
import { formatMoment, signalWords } from '../words.ts';

const ADVISORY =
  'These are possible duplicates. Nothing has been blocked or held. Check each one in the records.';

const columns: readonly Column<DuplicateFlag>[] = [
  {
    key: 'signal',
    header: 'Why it was flagged',
    rowHeader: true,
    cell: (flag) => `${signalWords[flag.signal]} another record`,
  },
  { key: 'raised', header: 'Raised', cell: (flag) => formatMoment(flag.raisedAt) },
  {
    key: 'check',
    header: 'Check it',
    cell: () => <Link to="/crm/duplicates">Review in duplicates</Link>,
  },
];

/** The advisory flags for one application. It shows only what the server returns. */
export function FlagsPanel({ applicationId }: { applicationId: string }) {
  const can = useCan('assure.duplicates.review');
  if (!can) return null;
  return <Flags applicationId={applicationId} />;
}

function Flags({ applicationId }: { applicationId: string }) {
  const { state, retry } = useLoad(loadFlags, applicationId);
  return (
    <Panel title="Possible duplicates">
      <Notice tone="info" title="Flags are advisory">
        {ADVISORY}
      </Notice>
      <WhenLoaded state={state} label="Loading possible duplicates" retry={retry}>
        {({ flags }) => (
          <DataTable
            caption="Possible duplicates for this application"
            captionHidden
            columns={columns}
            rows={flags}
            rowKey={(flag) => flag.id}
            empty={<p className="text-muted">No possible duplicates found for this application.</p>}
          />
        )}
      </WhenLoaded>
    </Panel>
  );
}
