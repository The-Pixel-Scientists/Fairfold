// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the wave 1 specs share: the people of the `wave1` seed signed in through
// the API (staff finish MFA, applicants do not), calls with a chosen
// Idempotency-Key, and the audit log read back as the funder's administrator.
// The seed's accounts are keyed by tenant and role, so a spec names "the
// programme manager of linnetford" and never a person. Everything is synthetic.
//
// The specs run on a stack seeded with `wave1`:
//
//   pnpm stack down --volumes && pnpm stack && pnpm stack seed wave1
//   TPS_E2E_WAVE1=1 pnpm test:stack -- wave1

import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import type { Role } from '../../packages/domain/src/platform/index.ts';
import { applicantEmailOf, emailOf } from '../../packages/db/seed/scenario.ts';
import { wave1Tenants } from '../../packages/db/seed/scenarios/wave1/tenants.ts';
import { paced } from '../platform/modules/routes.ts';
import { Api, stepUp, type Answer } from '../support/api.ts';
import { auditEvents, type AuditEvent } from '../support/audit.ts';
import { consoleOrigin, portalOrigin, seedPassword, type Slug } from '../support/env.ts';
import { person, updateState } from '../support/state.ts';
import { expect, test } from '../support/test.ts';
import { nextCode, rememberKey } from '../support/totp.ts';

export { expect, test };

export type TenantSlug = 'linnetford' | 'crowmere' | 'sedgebrook';

/** The app's own sign-in pages and cookies are named by the journey's two slugs; the wave 1 slugs are the same kind of value. */
export const asSlug = (slug: TenantSlug): Slug => slug as unknown as Slug;

const enabled = process.env['TPS_E2E_STACK'] === '1' && process.env['TPS_E2E_WAVE1'] === '1';

/** Every wave 1 spec starts with this: tests run in order, on one worker, on a stack seeded with `wave1`. */
export function onWave1(): void {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  test.use({ actionTimeout: 30_000, navigationTimeout: 30_000 });
  test.skip(
    !enabled,
    'The wave 1 specs run on a stack seeded with `wave1`: pnpm stack seed wave1, then TPS_E2E_WAVE1=1 pnpm test:stack -- wave1.',
  );
}

const tenantOf = (slug: TenantSlug) => {
  const tenant = wave1Tenants.find((candidate) => candidate.slug === slug);
  if (tenant === undefined) throw new Error(`The wave1 scenario has no ${slug}.`);
  return tenant;
};

/** The state's name for a seeded member, so the journey's authenticator helpers work for them. */
export function staffName(slug: TenantSlug, role: Role): string {
  const tenant = tenantOf(slug);
  const member = tenant.staff.find(([, , has]) => has === role);
  if (member === undefined) throw new Error(`${slug} has no ${role} in the wave1 scenario.`);
  const name = `w1:${slug}:${role}`;
  updateState((state) => {
    state.people[name] = {
      ...state.people[name],
      email: emailOf(tenant, member),
      password: seedPassword(),
    };
  });
  return name;
}

interface SessionAnswer {
  mfa: 'enrol' | 'verify' | 'complete' | 'not_required';
  activeMembership?: { id: string } | null;
}

/** Signs a seeded member of staff in through the console's address, finishing MFA. */
export async function signInAs(slug: TenantSlug, role: Role): Promise<Api> {
  const name = staffName(slug, role);
  const { email, password } = person(name);
  const api = await Api.open(consoleOrigin);
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

/** The applicant of the tenant's first round at `index`, signed in through the portal's address. */
export async function signInApplicant(slug: TenantSlug, index = 0): Promise<Api> {
  const tenant = tenantOf(slug);
  const first = tenant.programmes?.[0]?.rounds[0]?.applications?.[index];
  if (first === undefined) throw new Error(`${slug} has no seeded applicant.`);
  const api = await Api.open(portalOrigin);
  await api.ok('POST', `/auth/tenants/${slug}/sign-in`, {
    json: { email: applicantEmailOf(tenant, first.applicant), password: seedPassword() },
  });
  return api;
}

/** The membership id the session acts as. */
export async function membershipOf(api: Api): Promise<string> {
  const { activeMembership } = await api.ok<SessionAnswer>('GET', '/auth/session');
  if (activeMembership === undefined || activeMembership === null) {
    throw new Error('The session has no active membership.');
  }
  return activeMembership.id;
}

/** Confirms it is them again, as the 5-minute window of ADR 0010 asks, so a step-up route goes through. */
export const confirmAgain = (api: Api, slug: TenantSlug, role: Role): Promise<void> =>
  stepUp(api, staffName(slug, role));

/** A call, paced past a 429 once. */
export const call = (api: Api, method: string, path: string, json?: unknown): Promise<Answer> =>
  paced(`${method} ${path}`, () => api.send(method, path, { json }));

/** A create call with the Idempotency-Key of the caller's choosing (ADR 0028), paced past a 429 once. */
export function keyed(
  api: Api,
  method: string,
  path: string,
  json?: unknown,
  key: string = randomUUID(),
): Promise<Answer> {
  // Api.send takes no headers; the session's own request context sends the key.
  const context = Reflect.get(api, 'context') as APIRequestContext;
  return paced(`${method} ${path}`, async () => {
    const response = await context.fetch(`/api${path}`, {
      method,
      data: json,
      headers: { 'idempotency-key': key },
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const bytes = await response.body();
    const text = bytes.toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return { status: response.status(), json: parsed, text, bytes, headers: response.headers() };
  });
}

/** An answer that must have this status, as its JSON. */
export async function jsonOf<T>(
  sent: Answer | Promise<Answer>,
  status: number | readonly number[] = 200,
): Promise<T> {
  const answer = await sent;
  const wanted = typeof status === 'number' ? [status] : status;
  expect(wanted, answer.text.slice(0, 300)).toContain(answer.status);
  return answer.json as T;
}

/** Whether a problem refuses without echoing what was asked: no path, id or slug in its text. */
export function echoesNothing(answer: Answer, ...values: string[]): boolean {
  return values.every((value) => !answer.text.includes(value));
}

/** The tenant's administrator, confirmed recently, who may read the audit log. */
export async function auditReader(slug: TenantSlug = 'linnetford'): Promise<Api> {
  const reader = await signInAs(slug, 'tenant_admin');
  await confirmAgain(reader, slug, 'tenant_admin');
  return reader;
}

/** The events of one action, newest first, confirming the administrator again if the window has passed. */
export async function eventsOf(
  reader: Api,
  slug: TenantSlug,
  action: string,
): Promise<AuditEvent[]> {
  const probe = await reader.send('GET', '/console/audit-events', { query: { action } });
  if (probe.status === 403) await confirmAgain(reader, slug, 'tenant_admin');
  return auditEvents(reader, { action });
}

/** The events of one action about one record. */
export async function eventsAbout(
  reader: Api,
  slug: TenantSlug,
  action: string,
  entityId: string,
): Promise<AuditEvent[]> {
  return (await eventsOf(reader, slug, action)).filter((event) => event.entityId === entityId);
}

/** The keys no request may use to say whose data it is or who is acting (rule 6). */
export const forgedKeys = [
  'tenantId',
  'tenant_id',
  'actorId',
  'membershipId',
  'deciderId',
] as const;

/** A well-formed id that no record has. */
export const ABSENT = '00000000-0000-4000-8000-000000000000';
