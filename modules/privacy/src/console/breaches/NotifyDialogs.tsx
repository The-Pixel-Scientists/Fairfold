// SPDX-License-Identifier: AGPL-3.0-or-later
//
// These record that a person told the ICO or the people affected. Nothing
// here sends, emails or files anything.

import { call } from '@pixel-scientists/domain/api';
import { FormField, Input, Select } from '@pixel-scientists/ui';
import { useState } from 'react';

import {
  breachClock,
  recordIcoNotification,
  recordSubjectNotification,
} from '../../contracts/index.ts';
import type { Breach } from '../../contracts/index.ts';
import { useNow, useZone } from '../hooks.ts';
import { ActionDialog, Options, refuse, text } from '../parts.tsx';
import { instantFrom, lateWords, localInput, methodWords } from '../words.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  breach: Breach;
  onChange: (breach: Breach) => void;
}

const NOT_SENT = 'This software has not sent anything. Record it once you have told them yourself.';

function IcoFields({
  breach,
  now,
  errorFor,
}: {
  breach: Breach;
  now: string;
  errorFor: (field: string) => string | undefined;
}) {
  const zone = useZone();
  const [notifiedAt, setNotifiedAt] = useState(now);
  const instant = instantFrom(notifiedAt, zone);
  const late = instant !== null && breachClock(breach.becameAwareAt, instant, instant).late;
  return (
    <>
      <FormField label="When you told the ICO" id="notifiedAt" error={errorFor('notifiedAt')}>
        <Input
          name="notifiedAt"
          type="datetime-local"
          value={notifiedAt}
          max={now}
          onChange={(event) => {
            setNotifiedAt(event.target.value);
          }}
        />
      </FormField>
      <FormField
        label="ICO reference"
        id="reference"
        hint="The reference the ICO gave you."
        error={errorFor('reference')}
      >
        <Input name="reference" autoComplete="off" />
      </FormField>
      {late && (
        <FormField
          label="Why the ICO was told late"
          id="lateReason"
          hint="That is more than 72 hours after you became aware, so a reason is needed."
          error={errorFor('lateReason')}
        >
          <Select name="lateReason" defaultValue="">
            <Options words={lateWords} blank="Choose a reason" />
          </Select>
        </FormField>
      )}
    </>
  );
}

export function IcoDialog({ open, onClose, breach, onChange }: Props) {
  const zone = useZone();
  const now = localInput(useNow(), zone);
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Record that we told the ICO"
      description={NOT_SENT}
      submit="Record that we told the ICO"
      fields={['notifiedAt', 'reference', 'lateReason']}
      action={async (data, idempotencyKey) => {
        const notifiedAt = instantFrom(text(data, 'notifiedAt'), zone);
        if (notifiedAt === null) throw refuse('notifiedAt', 'Enter when you told the ICO.');
        onChange(
          await call(recordIcoNotification, {
            params: { breachId: breach.id },
            body: {
              notifiedAt,
              reference: text(data, 'reference'),
              lateReason: text(data, 'lateReason') || null,
            },
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          }),
        );
        onClose();
      }}
    >
      {(errorFor) => <IcoFields breach={breach} now={now} errorFor={errorFor} />}
    </ActionDialog>
  );
}

export function SubjectsDialog({ open, onClose, breach, onChange }: Props) {
  const zone = useZone();
  const now = localInput(useNow(), zone);
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Record that we told the people affected"
      description={NOT_SENT}
      submit="Record that we told the people affected"
      fields={['notifiedAt', 'method']}
      action={async (data, idempotencyKey) => {
        const notifiedAt = instantFrom(text(data, 'notifiedAt'), zone);
        if (notifiedAt === null) throw refuse('notifiedAt', 'Enter when you told them.');
        onChange(
          await call(recordSubjectNotification, {
            params: { breachId: breach.id },
            body: { notifiedAt, method: text(data, 'method') },
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          }),
        );
        onClose();
      }}
    >
      {(errorFor) => (
        <>
          <FormField label="When you told them" id="notifiedAt" error={errorFor('notifiedAt')}>
            <Input name="notifiedAt" type="datetime-local" defaultValue={now} max={now} />
          </FormField>
          <FormField label="How you told them" id="method" error={errorFor('method')}>
            <Select name="method" defaultValue="email">
              <Options words={methodWords} />
            </Select>
          </FormField>
        </>
      )}
    </ActionDialog>
  );
}
