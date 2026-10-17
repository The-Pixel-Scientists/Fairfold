// SPDX-License-Identifier: AGPL-3.0-or-later

import { getApplication, listAttachments } from '@pixel-scientists/grants/contracts';
import type { Application, AttachmentView } from '@pixel-scientists/grants/contracts';
import { useCallback } from 'react';

import { callApi } from '../api.ts';
import { useRead } from '../party/useRead.ts';

/** Saves still on their way, by application. */
const saving = new Map<string, Promise<unknown>>();

/** How long a page waits for a save before it reads without it. A save that hangs must not stop the page opening. */
export const WAIT_FOR_SAVE_MS = 5000;

/**
 * Notes a save that is on its way, so the page that opens next reads the
 * answers after it, not before. Without this, leaving a section straight after
 * typing could show the old answers, and the next save would be based on them.
 */
export function trackSave<T>(applicationId: string, save: Promise<T>): Promise<T> {
  saving.set(applicationId, save);
  void save.finally(() => {
    if (saving.get(applicationId) === save) saving.delete(applicationId);
  });
  return save;
}

/** Resolves once any save to the application has finished, or after WAIT_FOR_SAVE_MS. */
async function afterSaves(applicationId: string): Promise<void> {
  const pending = saving.get(applicationId);
  if (pending === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, WAIT_FOR_SAVE_MS);
  });
  try {
    await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads one of the applicant's applications once any save to it has finished. */
export function useApplicationRead(applicationId: string) {
  const read = useCallback(async () => {
    await afterSaves(applicationId);
    return callApi(getApplication, { params: { applicationId } });
  }, [applicationId]);
  return useRead(read);
}

/** An application with the files attached to its file questions. */
export interface ApplicationWithFiles {
  application: Application;
  files: AttachmentView[];
}

/** As `useApplicationRead()`, with the application's files, read together so one retry reads both. */
export function useApplicationFilesRead(applicationId: string) {
  const read = useCallback(async (): Promise<ApplicationWithFiles> => {
    await afterSaves(applicationId);
    const [application, { attachments }] = await Promise.all([
      callApi(getApplication, { params: { applicationId } }),
      callApi(listAttachments, { params: { applicationId } }),
    ]);
    return { application, files: attachments };
  }, [applicationId]);
  return useRead(read);
}
