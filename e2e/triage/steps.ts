// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the triage and capability specs share: calls with the Idempotency-Key
// that create routes need, the membership ids of the journey's staff, the
// status of a job read until its file is ready, and the text that must never
// leave the funder's side. Every name and text is invented.

import { signInStaff, stepUp, type Answer, type Api } from '../support/api.ts';
import { auditEvents, type AuditEvent } from '../support/audit.ts';
import { person, readState } from '../support/state.ts';
import { expect, test } from '../support/test.ts';
import { paced, sendRoute } from '../platform/modules/routes.ts';

/** Text the applicant, a reviewer and every other tenant must never be sent. */
export const NOTE = 'qzx-note: ring the chair before the panel meets';
export const MESSAGE = 'qzx-message: the roof survey is overdue';
export const REPLY = 'qzx-reply: the survey is booked for May';

/** The specs read what the journey left; without it they have nothing to work on. */
export function needsJourney(): void {
  test.skip(
    readState().ids['application1Id'] === undefined,
    'The journey has not run: pnpm test:stack --project journey --workers 1 runs it first.',
  );
}

/** A create call, sent with a fresh Idempotency-Key and paced past a 429. */
export const create = (api: Api, path: string, json: unknown): Promise<Answer> =>
  sendRoute(api, { key: `POST ${path}`, method: 'POST', idempotent: true }, path, { json });

/** Any other call, paced past a 429. */
export const call = (api: Api, method: string, path: string, json?: unknown): Promise<Answer> =>
  paced(`${method} ${path}`, () => api.send(method, path, { json }));

/** A call that must succeed, with its JSON. */
export async function made<T>(sent: Promise<Answer>, status = 201): Promise<T> {
  const answer = await sent;
  expect(answer.status, answer.text.slice(0, 300)).toBe(status);
  return answer.json as T;
}

/** The membership id of a journey member, from the team list an administrator reads. */
export async function membershipIdOf(admin: Api, name: string): Promise<string> {
  const team = await admin.ok<{ members: { id: string; email: string }[] }>('GET', '/console/team');
  const found = team.members.find(({ email }) => email === person(name).email);
  if (found === undefined) throw new Error(`The team has no ${name}.`);
  return found.id;
}

/** The administrator who reads the audit log, signed in and recently confirmed. */
export async function auditReader(): Promise<Api> {
  const admin = await signInStaff('northfield', 'colleague');
  await stepUp(admin, 'colleague');
  return admin;
}

/** The events of one action about one record. */
export async function eventsAbout(
  reader: Api,
  action: string,
  entityId: string,
): Promise<AuditEvent[]> {
  return (await auditEvents(reader, { action })).filter((event) => event.entityId === entityId);
}

/** Reads a job's status until its file is ready, and gives the file's id. */
export async function readyFile(api: Api, path: string): Promise<string> {
  await expect
    .poll(async () => (await api.ok<{ status: string }>('GET', path)).status, {
      message: `${path} never became ready.`,
      timeout: 120_000,
    })
    .toMatch(/^(ready|failed)$/);
  const job = await api.ok<{ status: string; fileId?: string; failureCode?: string }>('GET', path);
  expect(job.status, job.failureCode).toBe('ready');
  return job.fileId ?? '';
}

export const fileRoute = (fileId: string): string => `/console/files/${fileId}`;
