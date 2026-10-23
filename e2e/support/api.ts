// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Calls to the stack's API as a signed-in person, the way an app does: the
// cookie jar keeps the session, and each request carries its app's origin.
// Staff come through the console's address and applicants through the
// portal's. The steps use it to set things up fast; the isolation walk uses it
// to look at status codes and bytes, which a page hides.

import { request, type APIRequestContext } from '@playwright/test';
import { encodeFileNameHeader } from '../../packages/domain/src/files/index.ts';

import { expect } from '../../scripts/e2e/fixtures.ts';
import { consoleOrigin, portalOrigin, type Slug } from './env.ts';
import { person } from './state.ts';
import { nextCode, rememberKey } from './totp.ts';

export interface Answer {
  status: number;
  /** The body parsed as JSON, or undefined when it is not JSON. */
  json: unknown;
  text: string;
  bytes: Buffer;
  headers: Record<string, string>;
}

export interface Call {
  /** The query, as strings. */
  query?: Record<string, string>;
  json?: unknown;
  /** A raw body, with the `File-Name` header that a raw upload names its file in. */
  file?: { name: string; bytes: Buffer };
}

export class Api {
  private readonly context: APIRequestContext;
  readonly origin: string;

  private constructor(context: APIRequestContext, origin: string) {
    this.context = context;
    this.origin = origin;
  }

  /** A session with no one signed in yet. */
  static async open(origin: string): Promise<Api> {
    return new Api(
      await request.newContext({ baseURL: origin, extraHTTPHeaders: { origin } }),
      origin,
    );
  }

  async send(method: string, path: string, call: Call = {}): Promise<Answer> {
    const response = await this.context.fetch(`/api${path}`, {
      method,
      params: call.query,
      ...(call.file === undefined
        ? { data: call.json }
        : {
            data: call.file.bytes,
            headers: {
              'content-type': 'application/octet-stream',
              'file-name': encodeFileNameHeader(call.file.name),
            },
          }),
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const bytes = await response.body();
    const text = bytes.toString('utf8');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status(), json, text, bytes, headers: response.headers() };
  }

  /** Calls a route that must succeed, and gives its JSON. */
  async ok<T = unknown>(method: string, path: string, call: Call = {}): Promise<T> {
    const answer = await this.send(method, path, call);
    expect(answer.status, `${method} ${path} answered ${answer.text.slice(0, 300)}`).toBeLessThan(
      300,
    );
    return answer.json as T;
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }
}

interface SessionAnswer {
  mfa: 'enrol' | 'verify' | 'complete' | 'not_required';
}

/** Signs a seeded or created person in through their app, finishing MFA for staff. */
async function signIn(origin: string, slug: Slug, name: string): Promise<Api> {
  const { email, password } = person(name);
  const api = await Api.open(origin);
  const session = await api.ok<SessionAnswer>('POST', `/auth/tenants/${slug}/sign-in`, {
    json: { email, password },
  });
  if (session.mfa === 'enrol') {
    const { key } = await api.ok<{ key: string }>('POST', '/auth/totp/enrol');
    rememberKey(name, key);
    await api.ok('POST', '/auth/totp/confirm', { json: { code: await nextCode(name) } });
  } else if (session.mfa === 'verify') {
    await api.ok('POST', '/auth/totp/verify', { json: { code: await nextCode(name) } });
  }
  return api;
}

export const signInStaff = (slug: Slug, name: string): Promise<Api> =>
  signIn(consoleOrigin, slug, name);

export const signInApplicant = (slug: Slug, name: string): Promise<Api> =>
  signIn(portalOrigin, slug, name);

/** Confirms it is them again, as release and team changes ask, so the next call may go through. */
export async function stepUp(api: Api, name: string): Promise<void> {
  await api.ok('POST', '/auth/step-up', {
    json: { password: person(name).password, code: await nextCode(name) },
  });
}
