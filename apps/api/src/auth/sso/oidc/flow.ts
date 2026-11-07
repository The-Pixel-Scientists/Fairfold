// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The start and the single use of an OIDC sign-in or step-up (ADR 0010,
// "SSO" and "Sessions"). Each flow has its own state, nonce, PKCE verifier
// and browser token, 256 bits each from the CSPRNG. The browser token goes
// only in a __Host- cookie; the state record, kept in auth.verification for
// 10 minutes, binds the tenant, the provider, the nonce and the verifier,
// and for a step-up the session it re-authenticates. Its key is a hash of
// the state and the browser token together, so a callback needs both: one
// from another browser finds nothing, and nothing is written for it. The
// record is taken in one DELETE, so a state completes at most once, even
// when two callbacks race. The provider's address is built from its stored
// endpoint and our own values alone, never from the request.

import { createHash, randomBytes } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';
import { z } from 'zod';

import { ATTRIBUTES, readCookie } from '../../cookies.ts';
import type { AuthTables } from '../../tables.ts';

/** How long a flow may take, in seconds. */
export const FLOW_SECONDS = 600;

export const BROWSER_COOKIE = '__Host-tps_sso_browser';

const RANDOM = /^[A-Za-z0-9_-]{43}$/;
const random = (): string => randomBytes(32).toString('base64url');

export interface Flow {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  /** For the browser cookie only. */
  readonly browser: string;
}

export const newFlow = (): Flow => ({
  state: random(),
  nonce: random(),
  verifier: random(),
  browser: random(),
});

/** The PKCE challenge for `verifier` (RFC 7636, S256). */
export const codeChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier, 'ascii').digest('base64url');

const recordSchema = z.strictObject({
  tenantId: z.uuid(),
  providerId: z.uuid(),
  nonce: z.string().regex(RANDOM),
  verifier: z.string().regex(RANDOM),
  /** For a step-up: the user and the hash of the session's token, in base64url. */
  stepUp: z.strictObject({ userId: z.uuid(), session: z.string().regex(RANDOM) }).optional(),
});

export type StateRecord = z.infer<typeof recordSchema>;

/** The record's key: SHA-256, kept apart from the table's other uses, of the state and browser token. */
const recordKey = (state: string, browser: string): string =>
  createHash('sha256')
    .update(`tps-sso-oidc-state\0${state}\0${browser}`, 'utf8')
    .digest('base64url');

/** Keep the flow's record in `trx`, as app_auth. */
export async function saveState(
  trx: Transaction<unknown>,
  flow: Flow,
  record: Omit<StateRecord, 'nonce' | 'verifier'>,
): Promise<void> {
  const value: StateRecord = { ...record, nonce: flow.nonce, verifier: flow.verifier };
  await trx
    .$extendTables<AuthTables>()
    .insertInto('auth.verification')
    .values({
      identifier: recordKey(flow.state, flow.browser),
      value: JSON.stringify(recordSchema.parse(value)),
      expires_at: new Date(Date.now() + FLOW_SECONDS * 1000),
    })
    .execute();
}

export type Taken =
  | { readonly found: true; readonly expired: boolean; readonly record: StateRecord }
  | { readonly found: false };

/**
 * Take the record for `state` started in the browser holding `browser`, in
 * one statement, as app_auth: it is gone afterwards whatever the caller
 * decides. An expired record is taken too, and reported as expired.
 */
export async function takeState(
  trx: Transaction<unknown>,
  state: string,
  browser: string,
): Promise<Taken> {
  const rows = await trx
    .$extendTables<AuthTables>()
    .deleteFrom('auth.verification')
    .where('identifier', '=', recordKey(state, browser))
    .returning((eb) => ['value', eb('expires_at', '>', eb.fn<Date>('now')).as('live')])
    .execute();
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) return { found: false };
  const parsed = recordSchema.safeParse(JSON.parse(row.value));
  if (!parsed.success) return { found: false };
  return { found: true, expired: !row.live, record: parsed.data };
}

/** The cookie that binds the flow to this browser. SameSite=Lax, so it comes back on the provider's top-level redirect. */
export const browserCookie = (browser: string): string =>
  `${BROWSER_COOKIE}=${browser}; ${ATTRIBUTES}; Max-Age=${String(FLOW_SECONDS)}`;

export const clearedBrowserCookie = (): string => `${BROWSER_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;

/** The browser token in the request's cookie, or undefined if there is none, more than one, or a malformed one. */
export function readBrowser(cookieHeader: string | undefined): string | undefined {
  const value = readCookie(cookieHeader, BROWSER_COOKIE);
  return value !== undefined && RANDOM.test(value) ? value : undefined;
}

export interface AuthorizationRequest {
  /** The provider's stored authorisation endpoint. */
  readonly endpoint: string;
  readonly clientId: string;
  /** Our configured callback address for the provider. */
  readonly redirectUri: string;
  readonly flow: Flow;
  /** Make the provider ask again (step-up): `prompt=login` and `max_age=0`. */
  readonly stepUp: boolean;
}

/** Where to send the browser. Our parameters replace any of the same name the stored endpoint carries. */
export function authorizationUrl(request: AuthorizationRequest): string {
  const { flow } = request;
  const url = new URL(request.endpoint);
  const parameters: Record<string, string> = {
    response_type: 'code',
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: 'openid email',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: codeChallenge(flow.verifier),
    code_challenge_method: 'S256',
    ...(request.stepUp ? { prompt: 'login', max_age: '0' } : {}),
  };
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  return url.href;
}
