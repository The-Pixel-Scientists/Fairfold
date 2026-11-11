// SPDX-License-Identifier: AGPL-3.0-or-later

import { readSubjectAccessRequest } from '@pixel-scientists/domain/platform/subject-access';
import type { JobRequest } from '@pixel-scientists/domain/platform/subject-access';
import {
  Button,
  EmptyState,
  Link,
  LoadingState,
  Notice,
  PageHeader,
  buttonClassName,
} from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { callApi } from '../../api.ts';
import { formatWhen } from '../audit-log/words.ts';
import { SettingsSections } from '../settings/SettingsFrame.tsx';
import { NotFound, useIdParam, usePolled } from './common.tsx';
import { SUBJECT_ACCESS_PATH, downloadPath } from './paths.ts';

const finalWords: Partial<Record<JobRequest['status'], string>> = {
  ready: 'Your export is ready to download.',
  failed: 'The export could not be made.',
  expired: 'This export has been deleted.',
};

const finished = ({ status }: JobRequest) => status !== 'queued' && status !== 'running';

function FindAgain() {
  return (
    <Link to={SUBJECT_ACCESS_PATH} className={buttonClassName('secondary')}>
      Find a person
    </Link>
  );
}

function Status({ request }: { request: JobRequest }) {
  switch (request.status) {
    case 'queued':
      return (
        <Notice tone="info" title="Your export is queued">
          <p>It will start in a moment. This page updates by itself.</p>
        </Notice>
      );
    case 'running':
      return (
        <Notice tone="info" title="Your export is being made">
          <p>It usually takes a few minutes. This page updates by itself.</p>
        </Notice>
      );
    case 'ready':
      return (
        <Notice
          tone="success"
          title="Your export is ready"
          action={
            <a href={downloadPath(request.fileId)} className={buttonClassName('primary')}>
              Download export (JSON)
            </a>
          }
        >
          <p>
            You can download it until {formatWhen(request.expiresAt, 'Europe/London')} UK time, then
            it is deleted. It may hold sensitive and special category data, so keep it secure. Only
            you can download it.
          </p>
        </Notice>
      );
    case 'failed':
      return (
        <Notice tone="danger" title="The export could not be made" action={<FindAgain />}>
          <p>No file was made. Find the person and create the export again.</p>
        </Notice>
      );
    case 'expired':
      return (
        <Notice tone="warning" title="This export has been deleted" action={<FindAgain />}>
          <p>Exports are deleted after 7 days. Find the person and create a new export.</p>
        </Notice>
      );
  }
}

function Export({ requestId }: { requestId: string }) {
  const read = useCallback(
    () => callApi(readSubjectAccessRequest, { params: { requestId } }),
    [requestId],
  );
  const { state, retry } = usePolled(read, finished);

  if (state.status === 'notFound') return <NotFound />;
  return (
    <div className="flex max-w-3xl flex-col gap-stack">
      <PageHeader
        title="Subject access export"
        description="Everything your funder stores about one person, as one JSON file."
      />
      <SettingsSections />
      <p role="status" className="sr-only">
        {state.status === 'ready' && state.changed ? finalWords[state.value.status] : ''}
      </p>
      {state.status === 'loading' && (
        <LoadingState label="Loading this export" className="rounded-lg bg-surface" />
      )}
      {state.status === 'failed' && (
        <EmptyState
          title="We could not load this export"
          action={<Button onClick={retry}>Try again</Button>}
        >
          <p>{state.message}</p>
        </EmptyState>
      )}
      {state.status === 'ready' && <Status request={state.value} />}
    </div>
  );
}

/** A subject access request: its progress, then the file to download. */
export default function ExportPage() {
  const requestId = useIdParam('requestId');
  return requestId === null ? <NotFound /> : <Export requestId={requestId} />;
}
