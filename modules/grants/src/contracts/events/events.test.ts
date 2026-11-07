// SPDX-License-Identifier: AGPL-3.0-or-later

import { definedEvent, payloadLeafProblems } from '@pixel-scientists/domain/events';
import { describe, expect, it } from 'vitest';

import { applicationSubmitted, decisionReleased } from './events.ts';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const submitted = {
  applicationId: id(1),
  roundId: id(2),
  programmeId: id(3),
  organisationId: id(4),
  applicantPersonId: id(5),
  route: 'portal',
  timing: 'on_time',
  submittedAt: '2026-11-18T09:30:00Z',
};

const released = {
  decisionId: id(1),
  applicationId: id(2),
  roundId: id(3),
  organisationId: id(4),
  recipientPersonId: id(5),
  releasedAt: '2026-11-18T09:30:00+01:00',
};

const cases = [
  { event: applicationSubmitted, valid: submitted, at: 'submittedAt', code: 'route' },
  { event: decisionReleased, valid: released, at: 'releasedAt', code: undefined },
] as const;

describe.each(cases)('$event.name', ({ event, valid, at, code }) => {
  const accepts = (data: object) => event.data.safeParse(data).success;

  it('is defined once, readable with the applications read permission', () => {
    expect(definedEvent(event.name)).toBe(event);
    expect(event.read).toBe('grants.applications.read');
  });

  it('carries only ids, enums and timestamps', () => {
    expect(payloadLeafProblems(event.data)).toEqual([]);
  });

  it('takes a valid payload, with an offset or Z', () => {
    expect(accepts(valid)).toBe(true);
    expect(accepts({ ...valid, [at]: '2026-11-18T09:30:00.123-05:00' })).toBe(true);
  });

  it('refuses an unknown key, a plain string for an id, and a local time', () => {
    expect(accepts({ ...valid, tenantId: id(9) })).toBe(false);
    expect(accepts({ ...valid, outcome: 'accepted' })).toBe(false);
    expect(accepts({ ...valid, applicationId: 'application-1' })).toBe(false);
    expect(accepts({ ...valid, [at]: '2026-11-18T09:30:00' })).toBe(false);
  });

  it('names no tenant, member, outcome, amount or contact detail', () => {
    const keys = Object.keys(event.data.shape).join(' ');
    expect(keys).not.toMatch(/tenant|actor|member|user|outcome|amount|currency|email|name|score/i);
    if (code !== undefined) expect(accepts({ ...valid, [code]: 'email' })).toBe(false);
  });
});

it('refuses a submission timing outside its list', () => {
  expect(applicationSubmitted.data.safeParse({ ...submitted, timing: 'late' }).success).toBe(true);
  expect(applicationSubmitted.data.safeParse({ ...submitted, timing: true }).success).toBe(false);
  expect(applicationSubmitted.data.safeParse({ ...submitted, timing: 'early' }).success).toBe(
    false,
  );
});

it('defines no event for a decision that is recorded but not released', () => {
  expect(definedEvent('grants.decision_recorded.v1')).toBeUndefined();
});
