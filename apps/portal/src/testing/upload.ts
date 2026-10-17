// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: a stand-in for the XMLHttpRequest that sends a file, so a test
// decides when an upload moves on, finishes or fails. Not part of the app.

import { act } from '@testing-library/react';
import { vi } from 'vitest';

import type { Reply } from './api.ts';

/** One upload the page has sent, waiting for the test to answer it. */
export class FakeUpload {
  method = '';
  url = '';
  /** The request headers, with lower-case names. */
  readonly headers: Record<string, string> = {};
  file: File | null = null;
  status = 0;
  responseText = '';
  responseURL = '';
  readonly upload: { onprogress: ((event: { loaded: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  private readonly sent: FakeUpload[];

  constructor(sent: FakeUpload[]) {
    this.sent = sent;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  send(file: File): void {
    this.file = file;
    this.sent.push(this);
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** Reports that this many bytes have gone. */
  async progress(loaded: number): Promise<void> {
    await act(() => {
      this.upload.onprogress?.({ loaded });
      return Promise.resolve();
    });
  }

  /** The API's answer. */
  async reply({ status, body }: Reply): Promise<void> {
    this.status = status;
    this.responseText = body === undefined ? '' : JSON.stringify(body);
    this.responseURL = `${window.location.origin}${this.url}`;
    await act(() => {
      this.onload?.();
      return Promise.resolve();
    });
  }

  /** The connection fails before there is an answer. */
  async fail(): Promise<void> {
    await act(() => {
      this.onerror?.();
      return Promise.resolve();
    });
  }
}

/** Replaces XMLHttpRequest. Returns the uploads sent so far, which grows as the page sends them. */
export function stubUploads(): FakeUpload[] {
  const sent: FakeUpload[] = [];
  vi.stubGlobal(
    'XMLHttpRequest',
    class extends FakeUpload {
      constructor() {
        super(sent);
      }
    },
  );
  return sent;
}
