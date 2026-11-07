// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round's reminder settings, as the console sends them. Inputs are strict
// and never name a member. Saving records a configuration version (rule 10)
// of entity type `grants.reminder_setting`, whose entity id is the round's
// id, with a diff by field path in the programme set-up's format
// (reminderSettingDiff()), and `grants.reminder_setting.updated`. The server
// checks each template is a transactional email template of the tenant.
//
// Drafts are reminded a whole number of calendar days before their
// effective closing time (effectiveClosingTime()), at the same clock time in
// Europe/London. A review is overdue `overdueAfterDays` days after it was
// assigned, since an assignment has no due date of its own; it is reminded
// then and every `repeatEveryDays` after, up to MAX_OVERDUE_REMINDERS times,
// until it is submitted or removed.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { configDiff, type ConfigDiff } from '../programme/config.ts';
import { reminderMessages, says } from './messages.ts';

export const reminderSettingConfigEntityType = 'grants.reminder_setting';

/** The most reminders one draft gets: one for each number of days before it closes. */
export const MAX_DRAFT_REMINDERS = 3;

/** The most overdue reminders one assignment gets. */
export const MAX_OVERDUE_REMINDERS = 3;

const days = (max: number) => z.int().min(1).max(max);

const templateId = idSchema.nullable();

export const reminderSettingInputSchema = z.strictObject({
  draft: z
    .strictObject({
      enabled: z.boolean(),
      daysBefore: z
        .array(days(30))
        .max(MAX_DRAFT_REMINDERS)
        .refine(
          (list) => new Set(list).size === list.length,
          says(reminderMessages.daysBeforeOnce),
        ),
      templateId,
    })
    .refine((draft) => !draft.enabled || draft.daysBefore.length > 0, {
      ...says(reminderMessages.daysBefore),
      path: ['daysBefore'],
    })
    .refine((draft) => !draft.enabled || draft.templateId !== null, {
      ...says(reminderMessages.template),
      path: ['templateId'],
    }),
  review: z
    .strictObject({
      enabled: z.boolean(),
      overdueAfterDays: days(60),
      repeatEveryDays: days(30),
      templateId,
    })
    .refine((review) => !review.enabled || review.templateId !== null, {
      ...says(reminderMessages.template),
      path: ['templateId'],
    }),
});

export type ReminderSettingInput = z.infer<typeof reminderSettingInputSchema>;

/**
 * The changes from one setting to the next, or none; `before` is null for a
 * round's first. Draft days are recorded as text, largest first, like
 * `14,7,1`, so their order as sent changes nothing.
 */
export function reminderSettingDiff(
  before: ReminderSettingInput | null,
  after: ReminderSettingInput,
): ConfigDiff {
  const flat = ({ draft, review }: ReminderSettingInput) => ({
    draft: { ...draft, daysBefore: [...draft.daysBefore].sort((a, b) => b - a).join(',') },
    review,
  });
  return configDiff(before === null ? null : flat(before), flat(after));
}
