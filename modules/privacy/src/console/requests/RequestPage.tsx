// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Button, Link, Notice, PageHeader, Panel, SummaryList, Tag } from '@pixel-scientists/ui';
import { useState } from 'react';

import { getRightsRequest, updateRightsRequest } from '../../contracts/index.ts';
import type { RightsRequest } from '../../contracts/index.ts';
import { useNow, useRead, useZone } from '../hooks.ts';
import { loadPersonName } from '../loaders.ts';
import { ActionDialog, Reading, text } from '../parts.tsx';
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
import { ClockPanel } from './ClockPanel.tsx';
import { REQUEST_FIELDS, RequestFields } from './RequestFields.tsx';
import { SubjectPanel } from './SubjectPanel.tsx';
import { TasksPanel } from './TasksPanel.tsx';

const loadRequest = (requestId: string) => call(getRightsRequest, { params: { requestId } });

interface Props {
  request: RightsRequest;
  onChange: (request: RightsRequest) => void;
  reload: () => void;
}

function Request({ request, onChange, reload }: Props) {
  const today = todayIn(useNow(), useZone());
  const name = useRead(loadPersonName, request.personId);
  const person = name.state.status === 'ready' ? name.state.value : null;
  const [editing, setEditing] = useState(false);
  const { clock } = request;

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[
          { label: 'Data protection requests', to: viewPath('requests') },
          { label: `${kindWords[request.kind]} request` },
        ]}
        title={`${kindWords[request.kind]} request`}
        eyebrow={<Tag tone={stateTone[clock.state]}>{stateWords[clock.state]}</Tag>}
        description={clockText(clock, today, request.clockEvents)}
        actions={
          <Button
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit request
          </Button>
        }
      />
      {clock.state === 'paused' && (
        <Notice tone="warning" title="The clock is stopped">
          <p>The due date is not known until the clock restarts.</p>
        </Notice>
      )}
      <Panel title="Details">
        <SummaryList
          items={[
            { term: 'Person', value: person ?? 'Name not available' },
            { term: 'Received', value: formatDate(request.receivedOn) },
            { term: 'How it arrived', value: channelWords[request.channel] },
            { term: 'Identity check', value: identityWords[request.identityCheck] },
            {
              term: 'Summary',
              value: <span className="whitespace-pre-wrap">{request.summary}</span>,
            },
            {
              term: 'Consent history',
              value: (
                <Link to={viewPath('consent', request.personId)} className="underline">
                  View consent history
                </Link>
              ),
            },
          ]}
        />
      </Panel>
      <ClockPanel request={request} onChange={onChange} />
      <TasksPanel requestId={request.id} />
      <SubjectPanel request={request} person={person} onStarted={reload} />
      <ActionDialog
        open={editing}
        onClose={() => {
          setEditing(false);
        }}
        title="Edit request"
        submit="Save request"
        fields={REQUEST_FIELDS}
        action={async (data) => {
          onChange(
            await call(updateRightsRequest, {
              params: { requestId: request.id },
              body: {
                kind: text(data, 'kind'),
                channel: text(data, 'channel'),
                identityCheck: text(data, 'identityCheck'),
                summary: text(data, 'summary'),
              },
            }),
          );
          setEditing(false);
        }}
      >
        {(errorFor) => <RequestFields errorFor={errorFor} initial={request} />}
      </ActionDialog>
    </div>
  );
}

export function RequestPage({ requestId }: { requestId: string }) {
  const { state, reload, set } = useRead(loadRequest, requestId);
  return (
    <Reading state={state} label="Loading request" retry={reload}>
      {(request) => <Request request={request} onChange={set} reload={reload} />}
    </Reading>
  );
}
