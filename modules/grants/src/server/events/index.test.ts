// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { applicationSubmitted, decisionReleased } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { publishApplicationSubmitted, publishDecisionReleased, timingOf } from './index.ts';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const tx = {} as Tx;
const cause = { requestId: id(8), membershipId: id(9) };

const application = {
  id: id(1),
  roundId: id(2),
  programmeId: id(3),
  organisationId: id(4),
  applicantPersonId: id(5),
  route: 'portal',
  late: false,
  submittedAt: new Date('2026-11-18T09:30:00Z'),
} as const;

const decision = {
  id: id(1),
  applicationId: id(2),
  roundId: id(3),
  organisationId: id(4),
  recipientPersonId: id(5),
  releasedAt: new Date('2026-11-19T10:00:00Z'),
} as const;

describe('timingOf', () => {
  it('maps the stored late flag to on_time or late', () => {
    expect(timingOf(false)).toBe('on_time');
    expect(timingOf(true)).toBe('late');
  });
});

describe('publishApplicationSubmitted', () => {
  it('publishes ids, the route, the timing and the time, which the event accepts', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    await publishApplicationSubmitted(tx, { publish }, cause, { ...application, late: true });

    expect(publish).toHaveBeenCalledOnce();
    const [, event, data, by] = publish.mock.calls[0] as [unknown, unknown, object, object];
    expect(event).toBe(applicationSubmitted);
    expect(by).toBe(cause);
    expect(data).toEqual({
      applicationId: id(1),
      roundId: id(2),
      programmeId: id(3),
      organisationId: id(4),
      applicantPersonId: id(5),
      route: 'portal',
      timing: 'late',
      submittedAt: '2026-11-18T09:30:00.000Z',
    });
    expect(applicationSubmitted.data.safeParse(data).success).toBe(true);
  });

  it('carries the assisted route as it is', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    await publishApplicationSubmitted(tx, { publish }, cause, {
      ...application,
      route: 'assisted',
    });
    expect(publish.mock.calls[0]?.[2]).toMatchObject({ route: 'assisted', timing: 'on_time' });
  });
});

describe('publishDecisionReleased', () => {
  it('publishes ids and the release time only: no outcome and no amount', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    await publishDecisionReleased(tx, { publish }, cause, decision);

    const [, event, data, by] = publish.mock.calls[0] as [unknown, unknown, object, object];
    expect(event).toBe(decisionReleased);
    expect(by).toBe(cause);
    expect(Object.keys(data).sort()).toEqual([
      'applicationId',
      'decisionId',
      'organisationId',
      'recipientPersonId',
      'releasedAt',
      'roundId',
    ]);
    expect(decisionReleased.data.safeParse(data).success).toBe(true);
  });
});
