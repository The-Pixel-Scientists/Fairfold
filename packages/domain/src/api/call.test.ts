// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { fileNameMessages, fileRefusalMessages } from '../files/messages.ts';
import { fileViewSchema } from '../files/view.ts';
import { idSchema } from '../id.ts';
import { messages } from '../platform/messages.ts';
import {
  call,
  upload,
  type Fetch,
  type UploadFile,
  type UploadOptions,
  type UploadRequest,
} from './call.ts';
import { ProblemError } from './problem.ts';
import { defineRoute, type JsonRouteContract, type UploadRouteContract } from './route.ts';

const ID = '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90';

const updateProgramme = defineRoute({
  method: 'PATCH',
  path: '/console/programmes/:programmeId',
  audience: 'console',
  module: 'grants',
  summary: 'Change a programme',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
  params: z.strictObject({ programmeId: idSchema }),
  query: z.strictObject({ stage: z.array(z.string()).optional(), note: z.string().optional() }),
  body: z.strictObject({ title: z.string().min(1) }),
  responses: { 200: z.object({ id: idSchema, title: z.string() }) },
});

const signOut = defineRoute({
  method: 'POST',
  path: '/auth/sign-out',
  audience: 'auth',
  module: 'platform',
  summary: 'Sign out',
  permission: null,
  scope: null,
  session: 'any',
  responses: { 204: null },
});

function answering(status: number, body?: unknown) {
  return vi.fn<Fetch>(() =>
    Promise.resolve({
      status,
      json: () =>
        body === undefined ? Promise.reject(new Error('No body')) : Promise.resolve(body),
    }),
  );
}

async function failure(promise: Promise<unknown>): Promise<ProblemError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemError) return error;
    throw error;
  }
  throw new Error('Expected the call to fail.');
}

const input = {
  params: { programmeId: ID },
  query: { stage: ['intake', 'review'], note: 'a&b c' },
  body: { title: 'Community Spaces Fund' },
};

describe('call', () => {
  it('sends JSON same-origin to the API path and returns the parsed answer', async () => {
    const fetch = answering(200, { id: ID, title: 'Community Spaces Fund', secret: 'x' });
    const result = await call(updateProgramme, input, { fetch });
    expect(result).toEqual({ id: ID, title: 'Community Spaces Fund' });
    expect(fetch).toHaveBeenCalledWith(
      `/api/console/programmes/${ID}?stage=intake&stage=review&note=a%26b%20c`,
      {
        method: 'PATCH',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: '{"title":"Community Spaces Fund"}',
        credentials: 'same-origin',
        redirect: 'error',
      },
    );
  });

  it('sends no body when the route takes none, and returns nothing for 204', async () => {
    const fetch = answering(204);
    await expect(call(signOut, {}, { fetch })).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      redirect: 'error',
    });
  });

  it('takes a base path, and refuses one that is not a plain path', async () => {
    const fetch = answering(204);
    await call(signOut, {}, { fetch, basePath: '' });
    await call(signOut, {}, { fetch, basePath: '/api/v1' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/auth/sign-out',
      '/api/v1/auth/sign-out',
    ]);
    for (const basePath of ['api', '/api/', '//evil.example', 'https://evil.example', '/api/..']) {
      await expect(call(signOut, {}, { fetch, basePath })).rejects.toThrow(TypeError);
    }
  });

  it('refuses a route whose path does not start with its audience', async () => {
    const fetch = answering(204);
    for (const path of ['/health', '//evil.example/auth/sign-out', 'auth/sign-out', '/api/auth']) {
      const route = { ...signOut, path } as JsonRouteContract;
      await expect(call(route, {}, { fetch })).rejects.toThrow(TypeError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a route that answers a raw body, before sending anything', async () => {
    const fetch = answering(200, {});
    const stylesheet = { ...signOut, method: 'GET', responses: { 200: { raw: ['text/css'] } } };
    // @ts-expect-error call() takes only routes that answer JSON or nothing.
    await expect(call(stylesheet, {}, { fetch })).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never repeats a record key the contract refused', async () => {
    const answers = z.record(z.string().regex(/^f_[a-z]+$/), z.string());
    const route = defineRoute({ ...updateProgramme, body: z.strictObject({ answers }) });
    const body = { answers: { '<b>hunter2</b>': 'x' } };
    const error = await failure(
      call(route, { params: input.params, query: {}, body }, { fetch: answering(200) }),
    );
    expect(error.errors).toEqual([{ field: 'body.answers', message: 'This value is not valid.' }]);
  });

  it('refuses a dot segment or an object in the URL, even if a contract would let it through', async () => {
    // Contracts built without defineRoute(), so the route rules have not run.
    const looseParams = {
      ...signOut,
      path: '/auth/things/:thingId',
      params: z.strictObject({ thingId: z.string() }),
    } as JsonRouteContract;
    const looseQuery = {
      ...signOut,
      query: z.strictObject({ filter: z.strictObject({ stage: z.string() }) }),
    } as JsonRouteContract;
    const fetch = answering(204);
    for (const thingId of ['', '.', '..']) {
      const error = await failure(call(looseParams, { params: { thingId } } as never, { fetch }));
      expect(error).toMatchObject({ status: 400, detail: messages.requestFailed });
    }
    const error = await failure(
      call(looseQuery, { query: { filter: { stage: 'x' } } } as never, { fetch }),
    );
    expect(error).toMatchObject({ status: 400, detail: messages.requestFailed });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses input the contract refuses, before sending anything', async () => {
    const fetch = answering(200);
    const error = await failure(
      call(
        updateProgramme,
        { ...input, params: { programmeId: 'x' }, body: { title: '' } },
        { fetch },
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(error.status).toBe(400);
    expect(error.detail).toBe(messages.fixFields);
    expect(error.errors).toEqual([
      { field: 'params.programmeId', message: 'This id is not valid.' },
      { field: 'body.title', message: 'Enter at least 1 character.' },
    ]);
  });

  it('turns a problem response into the error, with its fields and request id', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Some fields are not valid. Fix the fields listed and try again.',
      requestId: 'req-1',
      errors: [{ field: 'body.title', message: 'Enter text.' }],
    };
    const error = await failure(call(updateProgramme, input, { fetch: answering(400, problem) }));
    expect(error).toMatchObject({
      status: 400,
      detail: problem.detail,
      requestId: 'req-1',
      errors: problem.errors,
    });
  });

  it('gives plain words when the answer is not a problem, or not what the contract says', async () => {
    const gateway = await failure(call(updateProgramme, input, { fetch: answering(502) }));
    expect(gateway).toMatchObject({ status: 502, detail: messages.serviceFailed, requestId: null });
    const teapot = await failure(call(updateProgramme, input, { fetch: answering(418, '<html>') }));
    expect(teapot.detail).toBe(messages.requestFailed);
    const undeclared = await failure(call(updateProgramme, input, { fetch: answering(201, {}) }));
    expect(undeclared.detail).toBe(messages.serviceFailed);
    const wrongShape = await failure(
      call(updateProgramme, input, { fetch: answering(200, { id: 1 }) }),
    );
    expect(wrongShape.detail).toBe(messages.serviceFailed);
  });

  it('says so when the API cannot be reached', async () => {
    const offline = vi.fn<Fetch>(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(call(signOut, {}, { fetch: offline }));
    expect(error).toMatchObject({ status: 0, detail: messages.noConnection });
  });
});

const attach = defineRoute({
  method: 'POST',
  path: '/portal/applications/:applicationId/files',
  audience: 'portal',
  module: 'grants',
  summary: 'Attach a file to an application',
  permission: 'grants.applications.apply',
  scope: 'own_application',
  params: z.strictObject({ applicationId: idSchema }),
  body: { raw: ['application/octet-stream'], maxBytes: 1024 },
  responses: { 201: fileViewSchema },
});

const view = {
  id: ID,
  name: 'Accounts 2025.pdf',
  type: 'application/pdf',
  bytes: 800,
  uploadedAt: '2026-10-09T10:15:00Z',
};

/** The part of XMLHttpRequest upload() uses, answered by the test. */
class FakeRequest implements UploadRequest {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: UploadFile | undefined;
  aborted = false;
  status = 0;
  responseText = '';
  responseURL = '';
  upload: UploadRequest['upload'] = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: UploadFile): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  answer(status: number, body?: unknown, responseURL = this.url): void {
    this.status = status;
    this.responseText = body === undefined ? '' : JSON.stringify(body);
    this.responseURL = responseURL;
    this.onload?.();
  }
}

/** The part of an AbortSignal upload() uses, with a way to abort it. */
function abortable() {
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    reason: undefined as unknown,
    listeners,
    addEventListener: (_type: 'abort', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'abort', listener: () => void) => listeners.delete(listener),
    abort(reason: unknown) {
      signal.aborted = true;
      signal.reason = reason;
      for (const listener of listeners) listener();
    },
  };
  return signal;
}

const file: UploadFile = { name: ' Accounts 2025.pdf ', size: 800 };

function start(options: UploadOptions = {}, chosen: UploadFile = file) {
  const requests: FakeRequest[] = [];
  const request = () => {
    const made = new FakeRequest();
    requests.push(made);
    return made;
  };
  const promise = upload(attach, { params: { applicationId: ID } }, chosen, {
    request,
    ...options,
  });
  const first = (): FakeRequest => {
    const [made] = requests;
    if (made === undefined) throw new Error('Nothing was sent.');
    return made;
  };
  return { promise, requests, request: first };
}

describe('upload', () => {
  it('sends the bytes same-origin with the name in File-Name, and reports progress', async () => {
    const progress: [number, number][] = [];
    const { promise, request } = start({
      onProgress: (sent, total) => progress.push([sent, total]),
    });
    const sent = request();
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`/api/portal/applications/${ID}/files`);
    expect(sent.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/octet-stream',
      'File-Name': 'Accounts%202025.pdf',
    });
    expect(sent.sent).toBe(file);
    sent.upload.onprogress?.({ loaded: 400 });
    sent.upload.onprogress?.({ loaded: 900 });
    expect(progress).toEqual([
      [400, 800],
      [800, 800],
    ]);
    sent.answer(201, view);
    await expect(promise).resolves.toEqual(view);
  });

  it('parses the answer with the route schema, as call() does', async () => {
    const extra = start();
    extra.request().answer(201, { ...view, storageKey: 'clean/x' });
    expect(await failure(extra.promise)).toMatchObject({
      status: 201,
      detail: messages.serviceFailed,
    });
    const notJson = start();
    notJson.request().answer(201);
    expect((await failure(notJson.promise)).detail).toBe(messages.serviceFailed);
  });

  it('turns a problem into the error, with its words and request id', async () => {
    const { promise, request } = start();
    const problem = {
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      detail: fileRefusalMessages.infected,
      requestId: 'req-2',
    };
    request().answer(422, problem);
    expect(await failure(promise)).toMatchObject({
      status: 422,
      detail: fileRefusalMessages.infected,
      requestId: 'req-2',
    });
    const gateway = start();
    gateway.request().answer(502, '<html>');
    expect(await failure(gateway.promise)).toMatchObject({
      status: 502,
      detail: messages.serviceFailed,
    });
  });

  it('turns a network error or a redirect into no connection', async () => {
    const offline = start();
    offline.request().onerror?.();
    expect(await failure(offline.promise)).toMatchObject({
      status: 0,
      detail: messages.noConnection,
    });
    const redirected = start();
    redirected.request().answer(201, view, '/sign-in');
    expect(await failure(redirected.promise)).toMatchObject({
      status: 0,
      detail: messages.noConnection,
    });
  });

  it('aborts on the signal with its reason, and lets go of the signal when done', async () => {
    const signal = abortable();
    const { promise, request } = start({ signal });
    const reason = new Error('Cancelled');
    signal.abort(reason);
    expect(request().aborted).toBe(true);
    await expect(promise).rejects.toBe(reason);
    expect(signal.listeners.size).toBe(0);

    const later = abortable();
    const done = start({ signal: later });
    done.request().answer(201, view);
    await done.promise;
    expect(later.listeners.size).toBe(0);
  });

  it('sends nothing when the signal has already aborted', async () => {
    const signal = abortable();
    const reason = new Error('Cancelled');
    signal.abort(reason);
    const { promise, requests } = start({ signal });
    await expect(promise).rejects.toBe(reason);
    expect(requests).toEqual([]);
  });

  it('refuses a bad name, a file over the limit or bad params, before sending', async () => {
    for (const [chosen, detail] of [
      [{ name: 'a/b.pdf', size: 1 }, fileNameMessages.characters],
      [{ name: ' ', size: 1 }, fileNameMessages.length],
      [{ name: 'big.pdf', size: 1025 }, fileRefusalMessages.too_large],
    ] as const) {
      const { promise, requests } = start({}, chosen);
      expect(await failure(promise)).toMatchObject({ status: 400, detail });
      expect(requests).toEqual([]);
    }
    const request = vi.fn(() => new FakeRequest());
    const bad = upload(attach, { params: { applicationId: 'x' } }, file, { request });
    expect(await failure(bad)).toMatchObject({ status: 400, detail: messages.fixFields });
    expect(request).not.toHaveBeenCalled();
  });

  it('takes only routes with the raw upload kind and no query, and call() refuses them', async () => {
    const request = vi.fn(() => new FakeRequest());
    const json = { ...attach, body: z.strictObject({ title: z.string() }) };
    const withQuery = { ...attach, query: z.strictObject({ note: z.string() }) };
    const tooLarge = { ...attach, body: { raw: ['application/octet-stream'], maxBytes: 2 ** 40 } };
    for (const route of [json, withQuery, tooLarge]) {
      await expect(
        upload(route as unknown as UploadRouteContract, {}, file, { request }),
      ).rejects.toThrow(TypeError);
    }
    expect(request).not.toHaveBeenCalled();
    const fetch = answering(201, view);
    await expect(call(attach as unknown as JsonRouteContract, {}, { fetch })).rejects.toThrow(
      TypeError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('takes a base path, as call() does', async () => {
    const { request } = start({ basePath: '' });
    expect(request().url).toBe(`/portal/applications/${ID}/files`);
    await expect(start({ basePath: '//evil.example' }).promise).rejects.toThrow(TypeError);
  });
});
