// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { messageNotificationJob, messageNotificationQueue } from './message-notifications.ts';

describe('the message notification queue', () => {
  it('is a tenant queue whose job holds one outbox row id and nothing else', () => {
    expect(messageNotificationQueue).toMatchObject({
      name: 'grants.message_notification',
      kind: 'tenant',
    });
    const notificationId = randomUUID();
    expect(messageNotificationQueue.data.parse({ notificationId })).toEqual({ notificationId });
    for (const extra of ['to', 'email', 'body', 'messageId', 'subject', 'tenantId']) {
      expect(
        messageNotificationQueue.data.safeParse({ notificationId, [extra]: 'x' }).success,
        extra,
      ).toBe(false);
    }
    expect(messageNotificationQueue.data.safeParse({ notificationId: 'not an id' }).success).toBe(
      false,
    );
  });

  it('has a job for the worker on that queue', () => {
    const job = messageNotificationJob({
      sender: { send: () => Promise.resolve({ sent: true }) },
      portalOrigin: 'https://portal.example.org',
    });

    expect(job.queue).toBe(messageNotificationQueue);
  });
});
