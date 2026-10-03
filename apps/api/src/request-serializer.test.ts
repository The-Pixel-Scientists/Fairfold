// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { CENSOR } from './redaction.ts';
import { loggableUrl, serializeRequest } from './request-serializer.ts';

describe('loggableUrl', () => {
  it('keeps the path of a request that matched a route', () => {
    expect(loggableUrl('/applications/0c7c3d1e', '/applications/:id')).toBe(
      '/applications/0c7c3d1e',
    );
  });

  it('keeps the keys of a query and never its values', () => {
    expect(
      loggableUrl('/applications?page=2&q=jane%40example.com&flag&empty=', '/applications'),
    ).toBe('/applications?page&q&flag&empty');
  });

  it('censors a key that does not look like a parameter name', () => {
    const tooLong = 'a'.repeat(65);
    expect(
      loggableUrl(
        `/applications?filter[status]=open&sort.by=x&jane@example.com&jane%40example.com&${tooLong}&&a%20b=1`,
        '/applications',
      ),
    ).toBe(
      `/applications?filter[status]&sort.by&${CENSOR}&${CENSOR}&${CENSOR}&${CENSOR}&${CENSOR}`,
    );
  });

  it('shows an auth route by its pattern and drops its query', () => {
    expect(
      loggableUrl(
        '/api/auth/reset-password/SECRET-TOKEN?callbackURL=https%3A%2F%2Fexample.org',
        '/api/auth/reset-password/:token',
      ),
    ).toBe(`/api/auth/reset-password/:token?${CENSOR}`);
    expect(loggableUrl('/auth/me', '/auth/me')).toBe('/auth/me');
  });

  it('judges a request that matched a route by the route, not by its path', () => {
    expect(loggableUrl('/%61uth/reset/SECRET-TOKEN?code=abc', '/auth/reset/:token')).toBe(
      `/auth/reset/:token?${CENSOR}`,
    );
    expect(loggableUrl('/authors?page=1', '/authors')).toBe('/authors?page');
  });

  it('shows a placeholder, never the path, for a request that matched no route', () => {
    for (const url of [
      '/auth/oidc/callback?code=SECRET&state=SECRET',
      '//auth/reset/SECRET',
      '/api//auth/reset/SECRET',
      '/auth;a/reset/SECRET',
      '/%61uth/reset/SECRET',
      '/api/%2561uth/SECRET',
      '/no-such-route?email=SECRET',
      '',
    ]) {
      expect(loggableUrl(url, undefined), url).toBe('[no route]');
    }
  });

  it('shortens a very long URL', () => {
    const url = `/search?${'x'.repeat(5000)}`;
    expect(loggableUrl(url, '/search').length).toBeLessThan(2100);
  });
});

describe('serializeRequest', () => {
  it('keeps the method, the host and the URL, and nothing else', () => {
    const output = serializeRequest({
      method: 'GET',
      url: '/applications?page=2',
      host: 'api.example.org',
      routeOptions: { url: '/applications' },
      // Not part of what the serialiser reads, whatever the request holds.
      ...{ headers: { authorization: 'Bearer SECRET' }, ip: '203.0.113.9', body: { a: 1 } },
    });

    expect(output).toEqual({
      method: 'GET',
      url: '/applications?page',
      host: 'api.example.org',
    });
  });

  it('copes with a request that has none of its parts', () => {
    expect(serializeRequest({})).toEqual({
      method: undefined,
      url: '[no route]',
      host: undefined,
    });
  });
});
