// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Background jobs (ADR 0009): the `./jobs` entry of the database package and
// the only code that imports pg-boss.

export {
  defineEventHandler,
  defineHandler,
  forEachTenant,
  JOB_ERROR_CODES,
  JobError,
  startHandlers,
  type JobErrorCode,
  type JobHandler,
  type JobLogger,
  type RunningJob,
  type WorkerSetup,
} from './handler.ts';
export { publish, type PublishContext } from './publish.ts';
export { defineQueue, definedQueues, type Queue, type QueueKind } from './queue.ts';
export { queueRegistrationProblems } from './registration.ts';
export {
  JobSendError,
  sendJob,
  startJobSender,
  stopJobSender,
  type JobContext,
  type JobSender,
  type SendJobOptions,
  type SendRefusal,
} from './send.ts';
