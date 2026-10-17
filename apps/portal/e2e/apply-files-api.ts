// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API's file routes in the apply specs (apply-api.ts adds
// them to its stub). An upload is checked as the server checks it: the name
// comes from the File-Name header, the type from the bytes, and the question's
// own limits apply. A spec can also script the API's answer to the next
// uploads, such as a virus or a lost connection, or hold uploads where they are.

import {
  decodeFileNameHeader,
  fileRefusalMessages,
  sniffFileType,
} from '@pixel-scientists/domain/files';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import type { Page, Route } from '@playwright/test';

import { problem } from './auth-api.ts';

/** A file attached to a question, as the list route answers it. */
export interface Attachment {
  id: string;
  fieldId: string;
  name: string;
  type: string;
  bytes: number;
  uploadedAt: string;
}

export const FILE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

export const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: FILE_ID,
  fieldId: 'f_accounts',
  name: 'accounts-2026.pdf',
  type: 'application/pdf',
  bytes: 2_202_010,
  uploadedAt: '2026-10-20T10:30:00.000Z',
  ...overrides,
});

/** What the API does with an upload other than take it: lose the connection, or refuse it in these words. */
export type UploadAnswer = 'drop' | { refuse: string };

/** An upload the API received. Only what it may know: the name is the one in the header. */
export interface Upload {
  applicationId: string;
  fieldId: string;
  name: string;
  bytes: number;
}

export interface FileStub {
  /** Every upload the API took or refused, in order. */
  uploads: Upload[];
  /** How the uploads that follow go, one answer each; after these, every upload is checked and taken. */
  answer: (...answers: UploadAnswer[]) => void;
  /** Holds every upload where it is, as a slow connection does, until the function this returns is called. */
  hold: () => () => void;
}

const UPLOAD = /\/api\/portal\/applications\/([^/]+)\/fields\/([^/]+)\/files$/;
const FILE = /\/api\/portal\/applications\/([^/]+)\/files\/([^/]+)$/;

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const refused = (route: Route, detail: string) => json(route, 422, problem(422, detail).body);

/** Takes uploads and removals for the applications whose files are in `files`, which a spec may read and change. */
export async function stubFiles(
  page: Page,
  files: Record<string, Attachment[]>,
  definition: FormDefinition,
): Promise<FileStub> {
  const stub: FileStub = { uploads: [], answer: () => undefined, hold: () => () => undefined };
  const answers: UploadAnswer[] = [];
  let gate: Promise<void> = Promise.resolve();
  stub.answer = (...next) => {
    answers.push(...next);
  };
  stub.hold = () => {
    let release = () => undefined;
    gate = new Promise((resolve) => {
      release = () => {
        resolve();
      };
    });
    return release;
  };

  await page.route(UPLOAD, async (route) => {
    const request = route.request();
    const [, applicationId = '', fieldId = ''] = UPLOAD.exec(new URL(request.url()).pathname) ?? [];
    const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
    const name = decodeFileNameHeader(request.headers()['file-name']);
    if (request.method() !== 'POST' || name === null) {
      await json(route, 400, problem(400, 'Send the file with its name.').body);
      return;
    }
    stub.uploads.push({ applicationId, fieldId, name, bytes: bytes.length });
    await gate;
    const next = answers.shift();
    if (next === 'drop') {
      await route.abort('failed');
      return;
    }
    if (next !== undefined) {
      await refused(route, next.refuse);
      return;
    }

    const field = definition.sections
      .flatMap((section) => section.fields)
      .find((candidate) => candidate.id === fieldId && candidate.type === 'file');
    const type = sniffFileType(new Uint8Array(bytes));
    const held = (files[applicationId] ??= []);
    if (field?.type !== 'file') {
      await json(route, 404, problem(404, 'Not found.').body);
    } else if (held.filter((file) => file.fieldId === fieldId).length >= field.maxFiles) {
      await refused(route, fileRefusalMessages.too_many);
    } else if (type === null || !field.allowedTypes.includes(type)) {
      await refused(route, fileRefusalMessages.type_not_allowed);
    } else {
      const added = attachment({
        id: crypto.randomUUID(),
        fieldId,
        name,
        type,
        bytes: bytes.length,
        uploadedAt: new Date().toISOString(),
      });
      held.push(added);
      await json(route, 201, added);
    }
  });

  await page.route(FILE, async (route) => {
    const request = route.request();
    const [, applicationId = '', fileId = ''] = FILE.exec(new URL(request.url()).pathname) ?? [];
    const held = files[applicationId] ?? [];
    const found = held.find((file) => file.id === fileId);
    if (found === undefined) {
      await json(route, 404, problem(404, 'Not found.').body);
    } else if (request.method() === 'DELETE') {
      files[applicationId] = held.filter((file) => file.id !== fileId);
      await route.fulfill({ status: 204 });
    } else {
      await route.fulfill({
        status: 200,
        contentType: found.type,
        headers: {
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(found.name)}`,
        },
        body: '%PDF-1.7 synthetic',
      });
    }
  });

  return stub;
}
