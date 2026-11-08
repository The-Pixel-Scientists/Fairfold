// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { releaseEmailJob, releaseEmailQueue } from './decision-emails.ts';

describe('the release email queue', () => {
  it('is a tenant queue whose job holds one outbox row id and nothing else', () => {
    expect(releaseEmailQueue).toMatchObject({ name: 'grants.release_email', kind: 'tenant' });
    const decisionEmailId = randomUUID();
    expect(releaseEmailQueue.data.parse({ decisionEmailId })).toEqual({ decisionEmailId });
    for (const extra of ['to', 'email', 'subject', 'templateVersionId', 'tenantId']) {
      expect(releaseEmailQueue.data.safeParse({ decisionEmailId, [extra]: 'x' }).success).toBe(
        false,
      );
    }
    expect(releaseEmailQueue.data.safeParse({ decisionEmailId: 'not an id' }).success).toBe(false);
  });

  it('has a job for the worker on that queue', () => {
    const job = releaseEmailJob({
      sender: { send: () => Promise.resolve({ sent: true }) },
      portalOrigin: 'https://portal.example.org',
    });

    expect(job.queue).toBe(releaseEmailQueue);
  });
});
