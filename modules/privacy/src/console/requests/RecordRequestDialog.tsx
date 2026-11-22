// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { FormField, Input } from '@pixel-scientists/ui';

import { createRightsRequest } from '../../contracts/index.ts';
import { useNow, useZone } from '../hooks.ts';
import { ActionDialog, refuse, text } from '../parts.tsx';
import { instantFrom, localInput } from '../words.ts';
import { REQUEST_FIELDS, RequestFields } from './RequestFields.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called once it is recorded. */
  onRecorded: () => void;
}

const FIELDS = ['personId', 'receivedAt', ...REQUEST_FIELDS];

/** Logs a request and starts its clock. The member who logs it comes from the session. */
export function RecordRequestDialog({ open, onClose, onRecorded }: Props) {
  const zone = useZone();
  const now = useNow();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Record request"
      description="Starts the clock from the day it arrived."
      submit="Record request"
      fields={FIELDS}
      action={async (data, idempotencyKey) => {
        const receivedAt = instantFrom(text(data, 'receivedAt'), zone);
        if (receivedAt === null) throw refuse('receivedAt', 'Enter the date and time it arrived.');
        await call(createRightsRequest, {
          body: {
            personId: text(data, 'personId').trim(),
            receivedAt,
            kind: text(data, 'kind'),
            channel: text(data, 'channel'),
            summary: text(data, 'summary'),
            identityCheck: text(data, 'identityCheck'),
          },
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        });
        onRecorded();
        onClose();
      }}
    >
      {(errorFor) => (
        <>
          <FormField
            label="Person's record ID"
            id="personId"
            hint="Copy it from the person's record. The server checks that it exists."
            error={errorFor('personId')}
          >
            <Input name="personId" autoComplete="off" spellCheck={false} />
          </FormField>
          <FormField label="Received" id="receivedAt" error={errorFor('receivedAt')}>
            <Input
              name="receivedAt"
              type="datetime-local"
              defaultValue={localInput(now, zone)}
              max={localInput(now, zone)}
            />
          </FormField>
          <RequestFields errorFor={errorFor} />
        </>
      )}
    </ActionDialog>
  );
}
