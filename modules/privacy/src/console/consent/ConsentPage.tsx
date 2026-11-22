// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { consentChannelLabels, consentPurposeLabels } from '@pixel-scientists/party/contracts';
import { DataTable, EmptyState, PageHeader } from '@pixel-scientists/ui';

import { getConsentHistory } from '../../contracts/index.ts';
import { useRead, useZone } from '../hooks.ts';
import { loadPersonName } from '../loaders.ts';
import { Reading } from '../parts.tsx';
import { viewPath } from '../paths.ts';
import { formatMoment } from '../words.ts';

const load = (personId: string) =>
  call(getConsentHistory, { params: { personId } }).then(({ entries }) => entries);

/** Every consent choice a person has made, newest first. Read only. */
export function ConsentPage({ personId }: { personId: string }) {
  const zone = useZone();
  const history = useRead(load, personId);
  const name = useRead(loadPersonName, personId);
  const person = name.state.status === 'ready' ? name.state.value : null;
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[
          { label: 'Data protection requests', to: viewPath('requests') },
          { label: 'Consent history' },
        ]}
        title="Consent history"
        description={`Every time ${person ?? 'this person'} gave or withdrew consent to be contacted, with the privacy notice they were shown.`}
      />
      <Reading state={history.state} label="Loading consent history" retry={history.reload}>
        {(entries) => (
          <DataTable
            caption="Consent changes, newest first"
            captionHidden
            rows={[...entries].reverse()}
            rowKey={(row) => `${row.recordedAt}-${row.purpose}-${row.channel}`}
            columns={[
              {
                key: 'when',
                header: 'Date',
                rowHeader: true,
                cell: (row) => formatMoment(row.recordedAt, zone),
              },
              {
                key: 'purpose',
                header: 'Purpose',
                cell: (row) => consentPurposeLabels[row.purpose],
              },
              {
                key: 'channel',
                header: 'Channel',
                cell: (row) => consentChannelLabels[row.channel],
              },
              {
                key: 'state',
                header: 'Choice',
                cell: (row) => (row.state === 'given' ? 'Gave consent' : 'Withdrew consent'),
              },
              {
                key: 'notice',
                header: 'Privacy notice version',
                cell: (row) => row.privacyNoticeVersion,
              },
            ]}
            empty={
              <EmptyState title="No consent choices recorded">
                <p>This person has not given or withdrawn consent to be contacted.</p>
              </EmptyState>
            }
          />
        )}
      </Reading>
    </div>
  );
}
