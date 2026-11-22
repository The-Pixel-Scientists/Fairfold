// SPDX-License-Identifier: AGPL-3.0-or-later

import { apiBasePath } from '@pixel-scientists/domain/api';
import { buttonClassName, Notice } from '@pixel-scientists/ui';

import { failureText, formatDay, words } from './jobs.ts';
import type { ExportKind, JobRequest } from './jobs.ts';

export interface ExportStatusProps {
  kind: ExportKind;
  /** The job, or null before its first read. */
  job: JobRequest | null;
}

/** Where a job is, in words, and the link to its file once it is ready. The file is never fetched here, so the server records each download. */
export function ExportStatus({ kind, job }: ExportStatusProps) {
  const { started, ready, link, noun } = words[kind];
  if (job === null || job.status === 'queued') {
    return (
      <Notice tone="info" title={started}>
        It will start in a moment. This page checks again by itself.
      </Notice>
    );
  }
  switch (job.status) {
    case 'running':
      return (
        <Notice tone="info" title={started}>
          This can take a few minutes. This page checks again by itself.
        </Notice>
      );
    case 'ready':
      return (
        <Notice
          tone="success"
          title={ready}
          action={
            <a
              href={`${apiBasePath}/console/files/${job.fileId}`}
              className={buttonClassName('primary')}
            >
              {link}
            </a>
          }
        >
          Available until {formatDay(job.expiresAt)}. Only you can download it.
        </Notice>
      );
    case 'failed':
      return (
        <Notice tone="danger" title={`The ${noun} could not be made`}>
          {failureText(job.failureCode)}
        </Notice>
      );
    case 'expired':
      return (
        <Notice tone="warning" title={`This ${noun} has been deleted`}>
          Files are deleted after 7 days. Start a new one.
        </Notice>
      );
  }
}

/** What a screen reader hears when a job ends, or null for the states that need no announcement. */
export function endedText(kind: ExportKind, job: JobRequest): string | null {
  const { ready, noun } = words[kind];
  switch (job.status) {
    case 'ready':
      return ready;
    case 'failed':
      return `Your ${noun} could not be made. ${failureText(job.failureCode)}`;
    case 'expired':
      return `Your ${noun} has been deleted. Start a new one.`;
    default:
      return null;
  }
}
