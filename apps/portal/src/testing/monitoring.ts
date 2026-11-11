// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: a round's equality monitoring form and a stand-in for the
// monitoring routes, built through the contracts. Not part of the app.

import {
  monitoringAnswerSchema,
  monitoringFormSchema,
  monitoringResponseSchema,
  monitoringTemplate,
} from '@pixel-scientists/grants/contracts';
import type { MonitoringResponse } from '@pixel-scientists/grants/contracts';

import { problem } from './api.ts';
import type { Reply } from './api.ts';
import { APPLICATION_ID } from './apply.ts';
import { ok } from './party.ts';

export const MONITORING_FORM_ID = '2e7a9c41-5b3d-4f68-8a1c-3d5e7f9b0a2c';

export const monitoringForm = (definition = monitoringTemplate()) =>
  monitoringFormSchema.parse({
    formVersionId: MONITORING_FORM_ID,
    definition,
    privacyNoticeVersion: '1.0',
    closesAt: '2026-11-02T17:00',
    timeZone: 'Europe/London',
  });

export interface MonitoringServer {
  /** The body of each response it accepted. */
  saved: unknown[];
  /** Its answers to the monitoring routes, to give `stubApi`. */
  handlers: Record<string, (body: unknown) => Reply>;
}

/** The monitoring routes for one application: its form, the applicant's own response, sending and withdrawing. */
export function monitoringServer(
  form = monitoringForm(),
  mine: MonitoringResponse | null = null,
): MonitoringServer {
  const base = `/portal/applications/${APPLICATION_ID}`;
  const server: MonitoringServer = { saved: [], handlers: {} };
  let response = mine;
  server.handlers = {
    [`GET ${base}/monitoring-form`]: () => ok(form),
    [`GET ${base}/monitoring`]: () => ok(monitoringAnswerSchema.parse({ response })),
    [`PUT ${base}/monitoring`]: (body) => {
      const input = body as { consent?: boolean; answers: Record<string, unknown> };
      if (input.consent !== true) return problem(422, 'Tick the box to agree.');
      server.saved.push(body);
      response = monitoringResponseSchema.parse({
        formVersionId: form.formVersionId,
        answers: input.answers,
        privacyNoticeVersion: form.privacyNoticeVersion,
        consentGivenAt: '2026-10-21T14:14:00.000Z',
      });
      return { status: 201, body: response };
    },
    [`DELETE ${base}/monitoring`]: () => {
      response = null;
      return { status: 204 };
    },
  };
  return server;
}

/** The monitoring routes of a round that has no monitoring form. */
export const noMonitoring: Record<string, () => Reply> = {
  [`GET /portal/applications/${APPLICATION_ID}/monitoring-form`]: () =>
    problem(404, 'There is no monitoring form.'),
  [`GET /portal/applications/${APPLICATION_ID}/monitoring`]: () =>
    ok(monitoringAnswerSchema.parse({ response: null })),
};
