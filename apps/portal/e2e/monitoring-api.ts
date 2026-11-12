// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the equality monitoring routes for the specs: the round's
// form, the applicant's own response, and sending and withdrawing. The form is
// the starting template from the grants contracts, so every question has
// "Prefer not to say". Give `handlers` to stubApply as `more`.

import { monitoringTemplate } from '@pixel-scientists/grants/contracts';

import { problem } from './auth-api.ts';
import type { Handler } from './auth-api.ts';

export const MONITORING_FORM_ID = '7c9e1a3b-5d2f-4a8c-9e6b-1d3f5a7c9e2b';

export interface MonitoringStub {
  handlers: Record<string, Handler>;
  /** The body of each response it accepted. */
  saved: unknown[];
  /** How many times an applicant withdrew. */
  withdrawn: () => number;
}

/** The monitoring routes of one application, with no answer given yet. */
export function stubMonitoring(applicationId: string): MonitoringStub {
  const path = `/portal/applications/${applicationId}`;
  let response: unknown = null;
  let withdrawals = 0;
  const saved: unknown[] = [];
  const handlers: Record<string, Handler> = {
    [`GET ${path}/monitoring-form`]: () => ({
      status: 200,
      body: {
        formVersionId: MONITORING_FORM_ID,
        definition: monitoringTemplate(),
        privacyNoticeVersion: '1.0',
        closesAt: '2026-11-02T17:00',
        timeZone: 'Europe/London',
      },
    }),
    [`GET ${path}/monitoring`]: () => ({ status: 200, body: { response } }),
    [`PUT ${path}/monitoring`]: (body) => {
      const input = body as { consent?: boolean; answers: unknown };
      if (input.consent !== true) return problem(422, 'Tick the box to agree.');
      saved.push(body);
      response = {
        formVersionId: MONITORING_FORM_ID,
        answers: input.answers,
        privacyNoticeVersion: '1.0',
        consentGivenAt: '2026-10-21T14:14:00.000Z',
      };
      return { status: 201, body: response };
    },
    [`DELETE ${path}/monitoring`]: () => {
      response = null;
      withdrawals += 1;
      return { status: 204 };
    },
  };
  return { handlers, saved, withdrawn: () => withdrawals };
}
