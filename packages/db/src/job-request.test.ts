// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The job request payload holds the request's id alone, and mostSensitive()
// classes an output by its most sensitive field, never low for a field it
// does not know.

import { randomUUID } from 'node:crypto';

import { payloadLeafProblems } from '@pixel-scientists/domain/events';
import { describe, expect, it } from 'vitest';

import { jobRequestPayload, mostSensitive } from './job-request.ts';
import { defineQueue } from './jobs/queue.ts';

describe('jobRequestPayload', () => {
  it('has only id leaves, and a queue may carry it', () => {
    expect(payloadLeafProblems(jobRequestPayload)).toEqual([]);
    expect(defineQueue('test_job_request_payload', 'tenant', jobRequestPayload).name).toBe(
      'test_job_request_payload',
    );
  });

  it('accepts the request id and refuses any other key', () => {
    const jobRequest = randomUUID();
    expect(jobRequestPayload.parse({ jobRequest })).toEqual({ jobRequest });
    for (const extra of [{ partyId: randomUUID() }, { filters: {} }, { fieldIds: [] }]) {
      expect(jobRequestPayload.safeParse({ jobRequest, ...extra }).success).toBe(false);
    }
    expect(jobRequestPayload.safeParse({ jobRequest: 'Ada Lovelace' }).success).toBe(false);
  });
});

describe('mostSensitive', () => {
  it('takes the most sensitive column', () => {
    expect(mostSensitive(['app.tenant.name'])).toBe('public');
    expect(mostSensitive(['app.tenant.name', 'app.membership.roles'])).toBe('internal');
    expect(mostSensitive(['app.membership.roles', 'app.file.name'])).toBe('personal');
    expect(mostSensitive(['app.file.name', 'grants.application.answers'])).toBe('special_category');
  });

  it("takes a form answer's class from its form version, or the highest if not given", () => {
    expect(mostSensitive(['app.tenant.name', 'f_budget'], { f_budget: 'internal' })).toBe(
      'internal',
    );
    expect(mostSensitive(['app.tenant.name', 'f_budget'])).toBe('special_category');
  });

  it('throws for an unknown field and an empty list, rather than classing low', () => {
    for (const fieldId of ['app.tenant.nickname', 'app.nothing.id', 'name', 'f_', 'F_X']) {
      expect(() => mostSensitive(['app.tenant.name', fieldId]), fieldId).toThrow(
        'is not in the classification map',
      );
    }
    expect(() => mostSensitive([])).toThrow('at least one field');
  });
});
