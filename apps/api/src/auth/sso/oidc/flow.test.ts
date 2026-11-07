// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  authorizationUrl,
  BROWSER_COOKIE,
  browserCookie,
  clearedBrowserCookie,
  codeChallenge,
  newFlow,
  readBrowser,
} from './flow.ts';

const ENDPOINT = 'https://idp.example.org/authorize';
const REDIRECT = 'https://console.example.org/auth/tenants/a/sso/oidc/p/callback';

describe('OIDC flow values', () => {
  it('draws state, nonce, verifier and browser token from 256 random bits each', () => {
    const flows = [newFlow(), newFlow()];
    const values = flows.flatMap(({ state, nonce, verifier, browser }) => [
      state,
      nonce,
      verifier,
      browser,
    ]);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(values).size).toBe(values.length);
  });

  it('makes the S256 challenge of RFC 7636’s example', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('authorizationUrl', () => {
  const flow = newFlow();
  const base = { endpoint: ENDPOINT, clientId: 'client-a', redirectUri: REDIRECT, flow };

  it('asks for the code flow with PKCE, state and nonce, and never sends the verifier', () => {
    const url = new URL(authorizationUrl({ ...base, stepUp: false }));
    expect(`${url.origin}${url.pathname}`).toBe(ENDPOINT);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-a',
      redirect_uri: REDIRECT,
      scope: 'openid email',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: codeChallenge(flow.verifier),
      code_challenge_method: 'S256',
    });
    expect(url.href).not.toContain(flow.verifier);
    expect(url.href).not.toContain(flow.browser);
  });

  it('makes the provider ask again for a step-up', () => {
    const url = new URL(authorizationUrl({ ...base, stepUp: true }));
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('max_age')).toBe('0');
  });

  it('keeps the endpoint’s own parameters but replaces any of ours', () => {
    const endpoint = `${ENDPOINT}?tenant=a&redirect_uri=https://evil.example.net&state=x`;
    const url = new URL(authorizationUrl({ ...base, endpoint, stepUp: false }));
    expect(url.searchParams.get('tenant')).toBe('a');
    expect(url.searchParams.getAll('redirect_uri')).toEqual([REDIRECT]);
    expect(url.searchParams.getAll('state')).toEqual([flow.state]);
  });
});

describe('browser cookie', () => {
  it('is __Host-, Secure, HttpOnly and SameSite=Lax, for the flow’s 10 minutes', () => {
    const cookie = browserCookie('b'.repeat(43));
    expect(cookie).toMatch(/^__Host-/);
    for (const part of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600']) {
      expect(cookie.split('; ')).toContain(part);
    }
    expect(cookie).not.toMatch(/Domain=/i);
    expect(clearedBrowserCookie()).toContain('Max-Age=0');
  });

  it('reads one well-formed token and nothing else', () => {
    const value = 'b'.repeat(43);
    expect(readBrowser(`a=1; ${BROWSER_COOKIE}=${value}`)).toBe(value);
    expect(readBrowser(undefined)).toBeUndefined();
    expect(readBrowser(`${BROWSER_COOKIE}=short`)).toBeUndefined();
    expect(readBrowser(`${BROWSER_COOKIE}=${value}; ${BROWSER_COOKIE}=${value}`)).toBeUndefined();
  });
});
