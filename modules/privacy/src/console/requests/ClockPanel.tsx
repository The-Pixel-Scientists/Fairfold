// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Button, FormField, Input, Panel, Select } from '@pixel-scientists/ui';
import { useState } from 'react';

import {
  closeRightsRequest,
  extendRightsRequest,
  pauseRightsRequest,
  resumeRightsRequest,
} from '../../contracts/index.ts';
import type { RightsRequest } from '../../contracts/index.ts';
import { useNow, useZone } from '../hooks.ts';
import { ActionDialog, Options, text } from '../parts.tsx';
import {
  closeWords,
  extensionWords,
  formatDate,
  pauseWords,
  resumeWords,
  todayIn,
} from '../words.ts';

type Action = 'pause' | 'resume' | 'extend' | 'close';

const sentence = (words: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(words).map(([key, value]) => [
      key,
      value.charAt(0).toUpperCase() + value.slice(1),
    ]),
  );

const config = {
  pause: {
    title: 'Stop the clock',
    description:
      'Use this while you wait for proof of identity or for the person to clarify. The due date is not known until the clock restarts.',
    label: 'Why it stops',
    reasons: sentence(pauseWords),
  },
  resume: {
    title: 'Restart the clock',
    description: 'The request shows its due date again once the clock is running.',
    label: 'Why it restarts',
    reasons: sentence(resumeWords),
  },
  extend: {
    title: 'Extend deadline',
    description: 'A request can be extended once, by 1 or 2 months.',
    label: 'Why it needs longer',
    reasons: sentence(extensionWords),
  },
  close: {
    title: 'Close request',
    description: 'Closing ends the clock. A closed request cannot be changed.',
    label: 'How it ended',
    reasons: sentence(closeWords),
  },
} as const;

function describe(event: RightsRequest['clockEvents'][number]): string {
  switch (event.kind) {
    case 'paused':
      return `Clock stopped: ${pauseWords[event.reason]}`;
    case 'resumed':
      return `Clock restarted: ${resumeWords[event.reason]}`;
    case 'extended':
      return `Extended by ${String(event.months)} month${event.months === 1 ? '' : 's'}: ${extensionWords[event.reason]}`;
    case 'closed':
      return `Closed: ${closeWords[event.reason]}`;
  }
}

interface Props {
  request: RightsRequest;
  onChange: (request: RightsRequest) => void;
}

/** Each change to the clock is its own action with a reason, recorded against the member who makes it. */
export function ClockPanel({ request, onChange }: Props) {
  const today = todayIn(useNow(), useZone());
  const [action, setAction] = useState<Action | null>(null);
  const [last, setLast] = useState<Action>('pause');
  const { state } = request.clock;
  const shown = config[action ?? last];

  const start = (next: Action) => () => {
    setLast(next);
    setAction(next);
  };

  async function send(data: FormData, idempotencyKey: string | undefined) {
    if (action === null) return;
    const params = { requestId: request.id };
    const on = text(data, 'on');
    const reason = text(data, 'reason');
    const key = idempotencyKey === undefined ? {} : { idempotencyKey };
    switch (action) {
      case 'pause':
        onChange(await call(pauseRightsRequest, { params, body: { on, reason }, ...key }));
        break;
      case 'resume':
        onChange(await call(resumeRightsRequest, { params, body: { on, reason }, ...key }));
        break;
      case 'close':
        onChange(await call(closeRightsRequest, { params, body: { on, reason }, ...key }));
        break;
      case 'extend':
        onChange(
          await call(extendRightsRequest, {
            params,
            body: { on, reason, months: Number(text(data, 'months')) },
            ...key,
          }),
        );
        break;
    }
    setAction(null);
  }

  return (
    <Panel
      title="Clock"
      actions={
        state !== 'closed' && (
          <>
            {state === 'paused' ? (
              <Button onClick={start('resume')}>Restart the clock</Button>
            ) : (
              <Button onClick={start('pause')}>Stop the clock</Button>
            )}
            <Button onClick={start('extend')}>Extend deadline</Button>
            <Button onClick={start('close')}>Close request</Button>
          </>
        )
      }
    >
      {request.clockEvents.length === 0 ? (
        <p className="text-body text-muted">
          The clock has run since the request arrived. Nothing has changed it.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-body">
          {request.clockEvents.map((event) => (
            <li key={`${event.kind}-${event.recordedAt}`}>
              <span className="font-medium">{formatDate(event.on)}</span> {describe(event)}
            </li>
          ))}
        </ol>
      )}
      <ActionDialog
        open={action !== null}
        onClose={() => {
          setAction(null);
        }}
        title={shown.title}
        description={shown.description}
        submit={shown.title}
        variant={action === 'close' ? 'danger' : 'primary'}
        fields={['on', 'months', 'reason']}
        action={send}
      >
        {(errorFor) => (
          <>
            <FormField label="Date" id="on" hint="The day it happened." error={errorFor('on')}>
              <Input name="on" type="date" defaultValue={today} max={today} />
            </FormField>
            {action === 'extend' && (
              <FormField label="Extend by" id="months" error={errorFor('months')}>
                <Select name="months" defaultValue="1">
                  <option value="1">1 month</option>
                  <option value="2">2 months</option>
                </Select>
              </FormField>
            )}
            <FormField label={shown.label} id="reason" error={errorFor('reason')}>
              <Select name="reason" defaultValue={Object.keys(shown.reasons)[0]}>
                <Options words={shown.reasons} />
              </Select>
            </FormField>
          </>
        )}
      </ActionDialog>
    </Panel>
  );
}
