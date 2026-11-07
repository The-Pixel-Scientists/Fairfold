// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The work a rights request needs, such as checking grants records, each
// assigned to a member by membership id and optionally to the tool whose
// records it concerns. Completing a task is its own POST.
//
// `privacy.requests.manage` lists, adds (`privacy.request_task.created`),
// changes (`.updated`) and completes (`.completed`) tasks.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { moduleIds } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { privacyMessages as m } from './messages.ts';
import { requestParamsSchema } from './requests.ts';
import { choice, dateSchema, line, timestampSchema } from './schemas.ts';

export const MAX_REQUEST_TASKS = 100;

export const requestTaskInputSchema = z.strictObject({
  title: line(200, m.taskTitle),
  assigneeMembershipId: idSchema.nullable(),
  moduleId: choice(moduleIds, m.module).nullable(),
  dueOn: dateSchema.nullable(),
});

export type RequestTaskInput = z.infer<typeof requestTaskInputSchema>;

export const requestTaskSchema = z.strictObject({
  id: idSchema,
  requestId: idSchema,
  title: z.string(),
  assigneeMembershipId: idSchema.nullable(),
  moduleId: z.enum(moduleIds).nullable(),
  dueOn: dateSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export type RequestTask = z.infer<typeof requestTaskSchema>;

/** At most MAX_REQUEST_TASKS, oldest first. */
export const requestTaskListSchema = z.strictObject({ tasks: z.array(requestTaskSchema) });

const manage = {
  audience: 'console',
  module: 'privacy',
  permission: 'privacy.requests.manage',
  scope: 'tenant',
} as const;

const task = { params: requestParamsSchema.extend({ taskId: idSchema }) } as const;

export const listRequestTasks = defineRoute({
  ...manage,
  params: requestParamsSchema,
  method: 'GET',
  path: '/console/rights-requests/:requestId/tasks',
  summary: "List a rights request's tasks",
  responses: { 200: requestTaskListSchema },
});

export const createRequestTask = defineRoute({
  ...manage,
  params: requestParamsSchema,
  method: 'POST',
  idempotent: true,
  path: '/console/rights-requests/:requestId/tasks',
  summary: 'Add a task to a rights request',
  body: requestTaskInputSchema,
  responses: { 201: requestTaskSchema },
});

export const updateRequestTask = defineRoute({
  ...manage,
  ...task,
  method: 'PUT',
  path: '/console/rights-requests/:requestId/tasks/:taskId',
  summary: 'Change a task on a rights request',
  body: requestTaskInputSchema,
  responses: { 200: requestTaskSchema },
});

export const completeRequestTask = defineRoute({
  ...manage,
  ...task,
  method: 'POST',
  idempotent: true,
  path: '/console/rights-requests/:requestId/tasks/:taskId/completion',
  summary: 'Mark a task on a rights request as done',
  responses: { 200: requestTaskSchema },
});

export const requestTaskRoutes = {
  listRequestTasks,
  createRequestTask,
  updateRequestTask,
  completeRequestTask,
} as const;
