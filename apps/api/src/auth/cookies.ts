// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Session tokens and cookies (ADR 0010). Each app has its own cookie, with
// the __Host- prefix, Secure, HttpOnly, SameSite=Lax and Path=/. A token is
// random and travels only in its cookie; the database keeps its SHA-256
// hash, so a stored hash presented as a token matches nothing.

import { createHash, randomBytes } from 'node:crypto';

import type { App } from '@pixel-scientists/domain/platform';

export const SESSION_COOKIES: Readonly<Record<App, string>> = {
  console: '__Host-tps_console_session',
  portal: '__Host-tps_portal_session',
};

/**
 * Each app's session timeouts in seconds (ADR 0010), which auth.session_context()
 * and auth.session_memberships() repeat; a test holds the three equal.
 */
export const TIMEOUTS: Readonly<Record<App, { idle: number; absolute: number }>> = {
  console: { idle: 30 * 60, absolute: 12 * 3600 },
  portal: { idle: 60 * 60, absolute: 24 * 3600 },
};

/** What a token looks like: ours are 43 characters of base64url, Better Auth's 32 letters and digits. */
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * The token in the app's session cookie, or undefined if the request has
 * none, more than one, or one that is not a token.
 */
export function readToken(cookieHeader: string | undefined, app: App): string | undefined {
  if (cookieHeader === undefined) return undefined;
  const name = SESSION_COOKIES[app];
  const values = cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${name}=`))
    .map((pair) => pair.slice(name.length + 1));
  const [value] = values;
  return values.length === 1 && value !== undefined && TOKEN.test(value) ? value : undefined;
}

const ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Lax';

export function sessionCookie(app: App, token: string): string {
  return `${SESSION_COOKIES[app]}=${token}; ${ATTRIBUTES}; Max-Age=${String(TIMEOUTS[app].absolute)}`;
}

export function clearedCookie(app: App): string {
  return `${SESSION_COOKIES[app]}=; ${ATTRIBUTES}; Max-Age=0`;
}
