// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the reminder routes answer: staff answers only. A reminder's history
// says what was due and what happened to it, never anything about the
// application, assignment or decision it concerns (rule 9).

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { reminderKindSchema, reminderOutcomeSchema, reminderReasonSchema } from './lists.ts';

/** A round's reminder setting as saved; `version` counts its configuration versions from 1. */
export const reminderSettingSchema = z.object({
  draft: z.object({
    enabled: z.boolean(),
    daysBefore: z.array(z.int()),
    templateId: idSchema.nullable(),
  }),
  review: z.object({
    enabled: z.boolean(),
    overdueAfterDays: z.int(),
    repeatEveryDays: z.int(),
    templateId: idSchema.nullable(),
  }),
  version: z.int(),
  updatedAt: z.iso.datetime(),
});

export type ReminderSetting = z.infer<typeof reminderSettingSchema>;

/** A round's setting, or null until someone saves one: then no reminders are sent. */
export const reminderSettingAnswerSchema = z.object({ setting: reminderSettingSchema.nullable() });

export type ReminderSettingAnswer = z.infer<typeof reminderSettingAnswerSchema>;

/**
 * A reminder that was due, when it was dealt with and what happened.
 * `reason` is set when it was not sent or could not be.
 */
export const reminderEntrySchema = z.object({
  kind: reminderKindSchema,
  at: z.iso.datetime(),
  outcome: reminderOutcomeSchema,
  reason: reminderReasonSchema.nullable(),
});

/** The reminders for one submission or assignment, the latest first. */
export const reminderHistorySchema = z.object({ reminders: z.array(reminderEntrySchema) });

export type ReminderHistory = z.infer<typeof reminderHistorySchema>;
