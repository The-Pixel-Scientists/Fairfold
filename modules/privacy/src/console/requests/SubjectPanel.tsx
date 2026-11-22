// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Export and erasure start here and nowhere else (rule 9, ADR 0027): one
// person, one request, one named confirmation. The server decides who may,
// asks for a recent sign-in, and refuses a closed request or an identity
// check that has not passed.

import { call } from '@pixel-scientists/domain/api';
import {
  Button,
  FormField,
  Input,
  Notice,
  Panel,
  buttonClassName,
  useCan,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import {
  getRequestErasure,
  getRequestExport,
  startRequestErasure,
  startRequestExport,
} from '../../contracts/index.ts';
import type { RightsRequest } from '../../contracts/index.ts';
import { usePolled, useZone } from '../hooks.ts';
import { ActionDialog, refuse, text } from '../parts.tsx';
import { downloadPath } from '../paths.ts';
import { useStepUp } from '../useStepUp.tsx';
import { formatMoment } from '../words.ts';

/** The word to type when the person's name cannot be read. */
const FALLBACK_WORD = 'erase';

function ExportStatus({ requestId }: { requestId: string }) {
  const zone = useZone();
  const state = usePolled(
    () => call(getRequestExport, { params: { requestId } }),
    ({ status }) => status !== 'queued' && status !== 'running',
  );
  if (state.status !== 'ready') {
    return <p className="text-body text-muted">Checking the export.</p>;
  }
  const job = state.value;
  switch (job.status) {
    case 'queued':
      return (
        <Notice tone="info" title="The export is queued">
          <p>It will start in a moment. This page checks again by itself.</p>
        </Notice>
      );
    case 'running':
      return (
        <Notice tone="info" title="The export is being made">
          <p>It usually takes a few minutes. This page checks again by itself.</p>
        </Notice>
      );
    case 'ready':
      return (
        <Notice
          tone="success"
          title="The export is ready"
          action={
            <a href={downloadPath(job.fileId)} className={buttonClassName('primary')}>
              Download file
            </a>
          }
        >
          <p>Only you can download it. It is deleted at {formatMoment(job.expiresAt, zone)}.</p>
        </Notice>
      );
    case 'failed':
      return (
        <Notice tone="danger" title="The export could not be made">
          <p>No file was made. Ask a colleague who manages the service to check it.</p>
        </Notice>
      );
    case 'expired':
      return (
        <Notice tone="warning" title="The export has been deleted">
          <p>Exports are deleted after 7 days.</p>
        </Notice>
      );
  }
}

function ErasureStatus({ requestId }: { requestId: string }) {
  const state = usePolled(
    () => call(getRequestErasure, { params: { requestId } }),
    ({ status }) => status === 'done' || status === 'failed',
  );
  if (state.status !== 'ready') {
    return <p className="text-body text-muted">Checking the erasure.</p>;
  }
  switch (state.value.status) {
    case 'queued':
    case 'running':
      return (
        <Notice tone="info" title="The erasure is in progress">
          <p>This page checks again by itself.</p>
        </Notice>
      );
    case 'done':
      return (
        <Notice tone="success" title="The person's data has been erased">
          <p>The audit trail keeps only ids and codes.</p>
        </Notice>
      );
    case 'failed':
      return (
        <Notice tone="danger" title="The erasure could not finish">
          <p>Ask a colleague who manages the service to check it.</p>
        </Notice>
      );
  }
}

interface Props {
  request: RightsRequest;
  /** The person's name as their record gives it, or null. */
  person: string | null;
  onStarted: () => void;
}

export function SubjectPanel({ request, person, onStarted }: Props) {
  const canExport = useCan('privacy.requests.export');
  const canErase = useCan('privacy.requests.erase');
  const stepUp = useStepUp();
  const [dialog, setDialog] = useState<'export' | 'erase' | null>(null);

  const open = request.clock.state !== 'closed';
  const identityPassed = ['verified', 'not_needed'].includes(request.identityCheck);
  const exportable = canExport && open && identityPassed;
  const erasable = canErase && open && identityPassed && request.kind === 'erasure';
  const { exportRequestId, erasureRequestId } = request;
  if (!exportable && !erasable && exportRequestId === null && erasureRequestId === null) {
    return null;
  }

  const who = person ?? 'this person';
  const expected = person ?? FALLBACK_WORD;
  const close = () => {
    setDialog(null);
  };

  return (
    <Panel
      title="Export and erasure"
      actions={
        <>
          {exportable && (
            <Button
              onClick={() => {
                setDialog('export');
              }}
            >
              Export this person's data
            </Button>
          )}
          {erasable && (
            <Button
              variant="danger"
              onClick={() => {
                setDialog('erase');
              }}
            >
              Erase this person's data
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {exportRequestId !== null && <ExportStatus key={exportRequestId} requestId={request.id} />}
        {erasureRequestId !== null && (
          <ErasureStatus key={erasureRequestId} requestId={request.id} />
        )}
        {exportRequestId === null && erasureRequestId === null && (
          <p className="text-body text-muted">
            Nothing has been exported or erased for this request.
          </p>
        )}
      </div>
      <ActionDialog
        open={dialog === 'export'}
        onClose={close}
        title="Export this person's data"
        description={`We will collect everything we hold about ${who} from every tool, including tools that are switched off, into one file. Only you can download it, and it is deleted after 7 days.`}
        submit="Export this person's data"
        fields={['export']}
        action={async (_data, idempotencyKey) => {
          const started = await stepUp.run(() =>
            call(startRequestExport, {
              params: { requestId: request.id },
              ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            }),
          );
          if (started === null) return;
          close();
          onStarted();
        }}
      >
        {() => (
          <p id="export" tabIndex={-1} className="text-body text-muted">
            Nothing is sent to the person.
          </p>
        )}
      </ActionDialog>
      <ActionDialog
        open={dialog === 'erase'}
        onClose={close}
        title="Erase this person's data"
        description={`Personal data about ${who} is removed or anonymised in every tool, including tools that are switched off. Records needed for the audit trail keep only ids and codes. This cannot be undone.`}
        submit={person === null ? "Erase this person's data" : `Erase ${person}'s data`}
        variant="danger"
        fields={['confirm']}
        action={async (data, idempotencyKey) => {
          if (text(data, 'confirm').trim() !== expected) {
            throw refuse('confirm', `Type ${expected} exactly as shown to confirm.`);
          }
          const started = await stepUp.run(() =>
            call(startRequestErasure, {
              params: { requestId: request.id },
              body: { confirm: true },
              ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            }),
          );
          if (started === null) return;
          close();
          onStarted();
        }}
      >
        {(errorFor) => (
          <FormField
            label={`Type ${expected} to confirm`}
            id="confirm"
            hint="This guards against erasing the wrong person. You will also be asked to confirm it is you."
            error={errorFor('confirm')}
          >
            <Input name="confirm" autoComplete="off" spellCheck={false} />
          </FormField>
        )}
      </ActionDialog>
      {stepUp.dialog}
    </Panel>
  );
}
