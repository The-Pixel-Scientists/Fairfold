// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reminder settings and history (rule 9: reminders only remind), for staff
// under `grants.programmes.manage` in the session's tenant. Settings are per
// round, beside its closing time and its review stages; updating one is
// versioned configuration (inputs.ts). History is read through a submission,
// so a draft's answers 404 as the submissions routes do, and its draft
// reminders show once it is submitted; or through an assignment.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  reminderHistorySchema,
  reminderSettingAnswerSchema,
  reminderSettingSchema,
} from './answers.ts';
import { reminderSettingInputSchema } from './inputs.ts';

const manage = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
} as const;

const round = { ...manage, params: z.strictObject({ roundId: idSchema }) } as const;

export const getReminderSetting = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/reminder-setting',
  summary: "Read a round's reminder setting, or null when none is saved",
  responses: { 200: reminderSettingAnswerSchema },
});

export const saveReminderSetting = defineRoute({
  ...round,
  method: 'PUT',
  path: '/console/rounds/:roundId/reminder-setting',
  summary: "Save a round's reminder setting as a new configuration version",
  body: reminderSettingInputSchema,
  responses: { 200: reminderSettingSchema },
});

export const listSubmissionReminders = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/submissions/:submissionId/reminders',
  summary: 'List the reminders for a submission, the latest first',
  params: z.strictObject({ submissionId: idSchema }),
  responses: { 200: reminderHistorySchema },
});

export const listAssignmentReminders = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/assignments/:assignmentId/reminders',
  summary: 'List the reminders for a review assignment, the latest first',
  params: z.strictObject({ assignmentId: idSchema }),
  responses: { 200: reminderHistorySchema },
});

export const reminderRoutes = {
  getReminderSetting,
  saveReminderSetting,
  listSubmissionReminders,
  listAssignmentReminders,
} as const;
