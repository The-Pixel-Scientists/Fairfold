// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The files on an application: sending one to a question, removing one, and
// where one downloads from. Every address here is made from ids. A file's
// name is shown as text and travels only in the upload's File-Name header: it
// is never put in an address, a page title or any other request.

import { ProblemError, apiBasePath, upload } from '@pixel-scientists/domain/api';
import {
  downloadAttachment,
  removeAttachment,
  uploadAttachment,
} from '@pixel-scientists/grants/contracts';
import type { AttachmentView } from '@pixel-scientists/grants/contracts';
import type { FormFiles } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../api.ts';

/** Where one of an application's files downloads from. */
export function downloadHref(applicationId: string, fileId: string): string {
  return `${apiBasePath}${downloadAttachment.path
    .replace(':applicationId', encodeURIComponent(applicationId))
    .replace(':fileId', encodeURIComponent(fileId))}`;
}

const SIGNED_OUT =
  'You were signed out, so the file was not added. Sign in again, then attach it again.';

export interface Files {
  /** What the form's file questions need: the list, and how to send, remove and open a file. */
  form: FormFiles;
  /** A file is on its way, so leaving the page would lose it. */
  uploading: boolean;
  /** The last removal did not go through. */
  removeFailed: boolean;
}

/**
 * An application's files, from the list the page loaded. An upload runs on
 * its own, so answers keep saving while it goes: the file joins the list once
 * the server has checked it, and an upload still on its way when the page is
 * left is cancelled.
 */
export function useFiles(applicationId: string, initial: readonly AttachmentView[]): Files {
  const [files, setFiles] = useState(initial);
  const [uploads, setUploads] = useState(0);
  const [removeFailed, setRemoveFailed] = useState(false);
  const cancel = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    cancel.current = controller;
    return () => {
      controller.abort();
    };
  }, []);

  async function onUpload(
    fieldId: string,
    file: File,
    onProgress: (sent: number, total: number) => void,
  ): Promise<void> {
    setUploads((count) => count + 1);
    try {
      const attached = await upload(
        uploadAttachment,
        { params: { applicationId, fieldId } },
        file,
        { onProgress, ...(cancel.current ? { signal: cancel.current.signal } : {}) },
      );
      setFiles((current) => [...current, attached]);
    } catch (error) {
      // The server's own words for this are about the session, not about what to do with the file.
      if (error instanceof ProblemError && error.status === 401) {
        throw new ProblemError(401, SIGNED_OUT);
      }
      throw error;
    } finally {
      setUploads((count) => count - 1);
    }
  }

  function onRemove(_fieldId: string, fileId: string): void {
    setRemoveFailed(false);
    callApi(removeAttachment, { params: { applicationId, fileId } }).then(
      () => {
        setFiles((current) => current.filter(({ id }) => id !== fileId));
      },
      (error: unknown) => {
        // Already gone, perhaps from another window: the list is right without it.
        if (error instanceof ProblemError && error.status === 404) {
          setFiles((current) => current.filter(({ id }) => id !== fileId));
        } else {
          setRemoveFailed(true);
        }
      },
    );
  }

  return {
    form: { files, hrefFor: (id) => downloadHref(applicationId, id), onUpload, onRemove },
    uploading: uploads > 0,
    removeFailed,
  };
}
