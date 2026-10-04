// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { getSession } from '@pixel-scientists/domain/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callApi, endSession, loadSession, retryAfterSeconds, tooManyAttempts } from './api.ts';
import { applicantSession, problem, signedOut, stubApi } from './testing/api.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('retryAfterSeconds', () => {
  it('reads a number of seconds', () => {
    expect(retryAfterSeconds('30')).toBe(30);
  });

  it('reads a date, as the time left until it, rounded up', () => {
    const now = Date.parse('2026-10-03T10:00:00Z');
    expect(retryAfterSeconds('Sat, 03 Oct 2026 10:01:30 GMT', now)).toBe(90);
    expect(retryAfterSeconds('Sat, 03 Oct 2026 09:59:00 GMT', now)).toBeNull();
  });

  it('says nothing for a missing or unusable header', () => {
    for (const header of [null, '', 'soon', '-5', '0', '1e9', '99999999']) {
      expect(retryAfterSeconds(header), String(header)).toBeNull();
    }
  });
});

describe('tooManyAttempts', () => {
  it('says how long to wait, in seconds or in minutes', () => {
    expect(tooManyAttempts(1)).toBe('Too many attempts. Wait 1 second, then try again.');
    expect(tooManyAttempts(30)).toBe('Too many attempts. Wait 30 seconds, then try again.');
    expect(tooManyAttempts(119)).toBe('Too many attempts. Wait 119 seconds, then try again.');
    expect(tooManyAttempts(900)).toBe('Too many attempts. Wait 15 minutes, then try again.');
    expect(tooManyAttempts(901)).toBe('Too many attempts. Wait 16 minutes, then try again.');
  });

  it('still says to wait when the API did not say how long', () => {
    expect(tooManyAttempts(null)).toBe('Too many attempts. Wait a few minutes, then try again.');
  });
});

describe('callApi', () => {
  it('returns what the contract says', async () => {
    const session = applicantSession();
    stubApi({ 'GET /auth/session': { status: 200, body: session } });
    expect(await callApi(getSession, {})).toEqual(session);
  });

  it('turns a 429 into words that say how long to wait, from Retry-After', async () => {
    stubApi({
      'GET /auth/session': { ...problem(429, 'Slow down.'), headers: { 'retry-after': '45' } },
    });

    const error = await callApi(getSession, {}).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).status).toBe(429);
    expect((error as ProblemError).detail).toBe(
      'Too many attempts. Wait 45 seconds, then try again.',
    );
    expect((error as ProblemError).requestId).toBe('req_test');
  });

  it('keeps the words of any other problem', async () => {
    stubApi({ 'GET /auth/session': problem(500, 'Something went wrong on our side.') });

    await expect(callApi(getSession, {})).rejects.toMatchObject({
      status: 500,
      detail: 'Something went wrong on our side.',
    });
  });

  it('says it could not reach the service when the network fails', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await expect(callApi(getSession, {})).rejects.toMatchObject({
      status: 0,
      detail: 'We could not reach the service. Check your connection and try again.',
    });
  });

  it('sends same-origin to /api, and never follows a redirect', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(applicantSession()), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await callApi(getSession, {});

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      redirect: 'error',
    });
  });
});

describe('loadSession', () => {
  it('returns the session', async () => {
    stubApi({ 'GET /auth/session': { status: 200, body: applicantSession() } });
    expect((await loadSession())?.user.email).toBe('ada@example.org');
  });

  it('returns null when nobody is signed in', async () => {
    stubApi({ 'GET /auth/session': signedOut });
    expect(await loadSession()).toBeNull();
  });

  it('throws when the session cannot be read, which is not the same as nobody being signed in', async () => {
    stubApi({ 'GET /auth/session': problem(503, 'Try again.') });
    await expect(loadSession()).rejects.toMatchObject({ status: 503 });
  });
});

describe('endSession', () => {
  it('signs out', async () => {
    const sent = stubApi({ 'POST /auth/sign-out': { status: 204 } });
    await endSession();
    expect(sent.map(({ key }) => key)).toEqual(['POST /auth/sign-out']);
  });

  it('counts a session that has already ended as ended', async () => {
    stubApi({ 'POST /auth/sign-out': signedOut });
    await expect(endSession()).resolves.toBeUndefined();
  });

  it('throws when the API cannot be reached, so the person is not told they are signed out', async () => {
    stubApi({ 'POST /auth/sign-out': problem(500, 'Failed.') });
    await expect(endSession()).rejects.toMatchObject({ status: 500 });
  });
});
