// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox relay's entry points: its job handlers and schedule, for the
// worker's registry and schedule list, and the operator's replay.

import { defineSchedule, type JobSchedule } from '@pixel-scientists/db/jobs';

import { relayFanOutQueue } from './relay.ts';

export { consumerCode, type ConsumerCode } from './consumers.ts';
export { replayConsumer, type ReplayRefusal, type ReplayResult } from './replay.ts';
export { BATCH_SIZE, outboxHandlers, relayFanOutQueue, relayQueue } from './relay.ts';

/** Every minute, Europe/London, so a new event reaches its consumers within about a minute. */
export const outboxSchedule: JobSchedule = defineSchedule(relayFanOutQueue, '* * * * *', {});
