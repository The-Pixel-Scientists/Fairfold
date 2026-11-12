// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  changeRetentionPolicy,
  listRetentionPolicies,
} from '@pixel-scientists/domain/platform/retention';
import type { RetentionPolicy } from '@pixel-scientists/domain/platform/retention';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  WhenLoaded,
  useLoad,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { SettingsSections } from '../settings/SettingsFrame.tsx';
import { useStepUp } from '../team/useStepUp.tsx';
import { ChangeForm } from './ChangeForm.tsx';
import { periodWords, policyName } from './period.ts';

const loadPolicies = async (): Promise<RetentionPolicy[]> =>
  (await callApi(listRetentionPolicies, {})).policies;

function Period({ days }: { days: number }) {
  return (
    <>
      {periodWords(days)} <span className="sr-only">({days.toLocaleString('en-GB')} days)</span>
    </>
  );
}

function Policies({ initial }: { initial: RetentionPolicy[] }) {
  const stepUp = useStepUp();
  const [policies, setPolicies] = useState(initial);
  const [editing, setEditing] = useState<RetentionPolicy | null>(null);
  const [saved, setSaved] = useState<{ policyId: string; message: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  // After a save, focus returns to the updated row's button.
  useEffect(() => {
    if (saved !== null) document.getElementById(`change-${saved.policyId}`)?.focus();
  }, [saved]);

  async function save(policy: RetentionPolicy, days: number) {
    const updated = await stepUp.run(() =>
      callApi(changeRetentionPolicy, { query: { policyId: policy.policyId }, body: { days } }),
    );
    if (updated === null) return;
    setPolicies((current) => current.map((p) => (p.policyId === updated.policyId ? updated : p)));
    setEditing(null);
    setSaved({
      policyId: updated.policyId,
      message: `${policyName(updated.labelKey)} period saved.`,
    });
  }

  return (
    <>
      <p role="status" className="min-h-6 text-body font-medium text-success">
        {saved?.message}
      </p>
      {editing !== null && (
        <ChangeForm
          key={editing.policyId}
          policy={editing}
          save={(days) => save(editing, days)}
          onCancel={() => {
            setEditing(null);
            opener.current?.focus();
          }}
        />
      )}
      <DataTable
        caption="How long each kind of data is kept"
        captionHidden
        rows={policies}
        rowKey={(policy) => policy.policyId}
        empty={
          <EmptyState title="No retention periods to set" headingLevel="h3">
            <p>This funder has no data with a period you can change.</p>
          </EmptyState>
        }
        columns={[
          {
            key: 'name',
            header: 'Kind of data',
            rowHeader: true,
            cell: (policy) => policyName(policy.labelKey),
          },
          { key: 'days', header: 'Kept for', cell: (policy) => <Period days={policy.days} /> },
          {
            key: 'minimum',
            header: 'Platform minimum',
            cell: (policy) => <Period days={policy.minimumDays} />,
          },
          {
            key: 'default',
            header: 'Default',
            cell: (policy) => <Period days={policy.defaultDays} />,
          },
          {
            key: 'changed',
            header: 'Set by',
            cell: (policy) => (policy.changed ? 'Your funder' : 'Default'),
          },
          {
            key: 'action',
            header: <span className="sr-only">Action</span>,
            align: 'end',
            cell: (policy) => (
              <Button
                id={`change-${policy.policyId}`}
                aria-label={`Change period for ${policyName(policy.labelKey)}`}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setSaved(null);
                  setEditing(policy);
                }}
              >
                Change period
              </Button>
            ),
          },
        ]}
      />
      {stepUp.dialog}
    </>
  );
}

/** How long each kind of the funder's data is kept, and a way to change it. */
export default function RetentionPage() {
  const { state, retry } = useLoad(loadPolicies);
  return (
    <div className="flex max-w-4xl flex-col gap-stack">
      <PageHeader
        title="Data retention"
        description="How long each kind of data is kept before it is deleted or anonymised. Changes ask you to confirm it is you first."
      />
      <SettingsSections />
      <ul role="list" className="flex list-disc flex-col gap-1 pl-5 text-body text-muted">
        <li>The platform sets each minimum. You cannot lower a period below it.</li>
        <li>A nightly job deletes or anonymises data past its period and records what it did.</li>
        <li>A shorter period applies from the next nightly run.</li>
        <li>A changed audit log period applies only to events recorded after the change.</li>
      </ul>
      <WhenLoaded state={state} label="Loading retention periods" retry={retry}>
        {(initial) => <Policies initial={initial} />}
      </WhenLoaded>
    </div>
  );
}
