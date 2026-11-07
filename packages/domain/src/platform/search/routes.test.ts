// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { call, type Fetch } from '../../api/call.ts';
import { ProblemError } from '../../api/problem.ts';
import { checkRoute } from '../../api/route.ts';
import { roles } from '../roles.ts';
import * as search from './routes.ts';

const { searchTerm } = search;

describe('searchTerm', () => {
  it('keeps every route rule', () => {
    expect(checkRoute(searchTerm)).toEqual([]);
    const exported = Object.values(search).filter((value) => 'audience' in value);
    expect(exported).toEqual(Object.values(search.searchRoutes));
  });

  it('takes the term in the body only, with no params or query', () => {
    expect(searchTerm).toMatchObject({
      method: 'POST',
      path: '/console/search',
      audience: 'console',
      module: 'platform',
      permission: 'platform.search.use',
      scope: 'tenant',
    });
    expect('params' in searchTerm).toBe(false);
    expect('query' in searchTerm).toBe(false);
  });

  // The data protection lead only answers a person's own request (ADR 0032), and is held beside another role.
  it('is open to every other console role, reviewers included', () => {
    const consoleRoles = Object.entries(roles).filter(([, role]) => role.app === 'console');
    const searching = consoleRoles.filter(([, role]) =>
      (role.permissions as readonly string[]).includes('platform.search.use'),
    );
    expect(searching.map(([name]) => name)).toEqual(
      consoleRoles.map(([name]) => name).filter((name) => name !== 'data_protection_lead'),
    );
    expect(searching.map(([name]) => name)).toContain('reviewer');
  });

  it('is not idempotent, so a failed search is never sent again', async () => {
    expect('idempotent' in searchTerm).toBe(false);
    const sent: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const fetch: Fetch = (url, init) => {
      sent.push({ url, headers: init.headers, body: init.body });
      return Promise.resolve({ status: 503, json: () => Promise.resolve({}) });
    };
    await expect(call(searchTerm, { body: { term: 'Zebedee' } }, { fetch })).rejects.toThrow(
      ProblemError,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/api/console/search');
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain('Idempotency-Key');
    expect(sent[0]?.body).toBe('{"term":"Zebedee"}');
  });

  it.each([
    ['too short', 'Z', ['Z']],
    ['too long', 'Zebedee '.repeat(20), ['Zebedee']],
    ['holding a control character', 'Zebedee\u0007Quaile', ['Zebedee', 'Quaile']],
  ])('never echoes a term that is %s', async (_name, term, words) => {
    const fetch: Fetch = () => Promise.reject(new Error('A refused term is never sent.'));
    const problem = await call(searchTerm, { body: { term } }, { fetch }).catch(
      (error: unknown) => error,
    );
    expect(problem).toBeInstanceOf(ProblemError);
    const { detail, message, errors } = problem as ProblemError;
    expect(errors.map((error) => error.field)).toEqual(['body.term']);
    const shown = JSON.stringify([detail, message, errors]);
    for (const word of words) expect(shown).not.toContain(word);
  });
});
