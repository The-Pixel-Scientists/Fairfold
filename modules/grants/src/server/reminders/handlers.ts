// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reminder settings and history routes' handlers (E4, E9), matched with
// their contracts in apps/api/src/modules.ts. The platform has already
// checked the session, the permission and the scope rule. A round's setting
// is versioned configuration (rule 10): a save that changes something writes
// the setting, its configuration version and its audit event in one
// transaction, and one that changes nothing writes none of them. History is
// read only, and holds kinds, times and codes, never an address or any text.

import type { AuditChanges } from '@pixel-scientists/db';

import {
  configDiffSchema,
  reminderSettingConfigEntityType,
  reminderSettingDiff,
  type ConfigDiff,
  type ReminderHistory,
  type ReminderKind,
  type ReminderSetting,
  type ReminderSettingAnswer,
  type ReminderSettingInput,
} from '../../contracts/index.ts';
import { submittedApplication } from '../notes/application.ts';
import type { Args, GrantsDependencies } from '../programme/context.ts';
import { readRound } from '../programme/read.ts';
import type { Tx } from '../programme/tables.ts';
import { reminderDb } from './tables.ts';

export interface ReminderDependencies extends Pick<GrantsDependencies, 'notFound' | 'refuse'> {
  /** Writes the round's next reminder setting version in the request's transaction. */
  readonly recordConfig: (
    tx: Tx,
    authorId: string,
    entityType: typeof reminderSettingConfigEntityType,
    entityId: string,
    diff: ConfigDiff,
  ) => Promise<void>;
}

const NOT_A_REMINDER = 'Choose a reminder template.';
const CONFLICT = 'Someone else saved these settings at the same moment. Reload and try again.';

type Round = { params: { roundId: string } };

interface Columns {
  draft_enabled: boolean;
  draft_days_before_1: number | null;
  draft_days_before_2: number | null;
  draft_days_before_3: number | null;
  draft_template_version_id: string | null;
  review_enabled: boolean;
  review_overdue_after_days: number;
  review_repeat_every_days: number;
  review_template_version_id: string | null;
}

/** A setting as stored: draft days largest first. */
function toColumns({ draft, review }: ReminderSettingInput): Columns {
  const [one, two, three] = [...draft.daysBefore].sort((a, b) => b - a);
  return {
    draft_enabled: draft.enabled,
    draft_days_before_1: one ?? null,
    draft_days_before_2: two ?? null,
    draft_days_before_3: three ?? null,
    draft_template_version_id: draft.templateId,
    review_enabled: review.enabled,
    review_overdue_after_days: review.overdueAfterDays,
    review_repeat_every_days: review.repeatEveryDays,
    review_template_version_id: review.templateId,
  };
}

function toInput(row: Columns): ReminderSettingInput {
  return {
    draft: {
      enabled: row.draft_enabled,
      daysBefore: [
        row.draft_days_before_1,
        row.draft_days_before_2,
        row.draft_days_before_3,
      ].filter((days) => days !== null),
      templateId: row.draft_template_version_id,
    },
    review: {
      enabled: row.review_enabled,
      overdueAfterDays: row.review_overdue_after_days,
      repeatEveryDays: row.review_repeat_every_days,
      templateId: row.review_template_version_id,
    },
  };
}

const selected = [
  'id',
  'draft_enabled',
  'draft_days_before_1',
  'draft_days_before_2',
  'draft_days_before_3',
  'draft_template_version_id',
  'review_enabled',
  'review_overdue_after_days',
  'review_repeat_every_days',
  'review_template_version_id',
  'version',
  'updated_at',
] as const;

export function reminderHandlers(deps: ReminderDependencies) {
  async function read(tx: Tx, roundId: string): Promise<ReminderSetting | null> {
    const row = await reminderDb(tx)
      .selectFrom('grants.reminder_setting')
      .select(selected)
      .where('round_id', '=', roundId)
      .executeTakeFirst();
    return row === undefined
      ? null
      : { ...toInput(row), version: row.version, updatedAt: row.updated_at.toISOString() };
  }

  /** Each template chosen must be a reminder template of its kind in this tenant, which row-level security limits the search to. */
  async function checkTemplates(tx: Tx, input: ReminderSettingInput): Promise<void> {
    const chosen: [ReminderKind, string | null, string][] = [
      ['draft_closing', input.draft.templateId, 'draft.templateId'],
      ['review_overdue', input.review.templateId, 'review.templateId'],
    ];
    for (const [kind, id, field] of chosen) {
      if (id === null) continue;
      const template = await reminderDb(tx)
        .selectFrom('grants.email_template_version')
        .select('outcome')
        .where('id', '=', id)
        .executeTakeFirst();
      if (template?.outcome !== kind) {
        throw deps.refuse(400, NOT_A_REMINDER, [{ field, message: NOT_A_REMINDER }]);
      }
    }
  }

  async function getReminderSetting({ tx, input }: Args<Round>): Promise<ReminderSettingAnswer> {
    if ((await readRound(tx, input.params.roundId)) === undefined) throw deps.notFound();
    return { setting: await read(tx, input.params.roundId) };
  }

  async function saveReminderSetting({
    tx,
    context,
    input,
  }: Args<Round & { body: ReminderSettingInput }>): Promise<ReminderSetting> {
    const { roundId } = input.params;
    if ((await readRound(tx, roundId, true)) === undefined) throw deps.notFound();
    await checkTemplates(tx, input.body);

    const db = reminderDb(tx);
    const actor = context.membership.id;
    const after = toColumns(input.body);
    const found = await db
      .selectFrom('grants.reminder_setting')
      .select(selected)
      .where('round_id', '=', roundId)
      .forUpdate()
      .executeTakeFirst();

    const before = found === undefined ? null : toColumns(toInput(found));
    const diff = reminderSettingDiff(before === null ? null : toInput(before), input.body);
    if (diff.length > 0) {
      if (found === undefined) {
        const inserted = await db
          .insertInto('grants.reminder_setting')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            round_id: roundId,
            ...after,
            created_by: actor,
            updated_by: actor,
          }))
          .onConflict((conflict) => conflict.doNothing())
          .returning('id')
          .executeTakeFirst();
        if (inserted === undefined) throw deps.refuse(409, CONFLICT);
      } else {
        await db
          .updateTable('grants.reminder_setting')
          .set({ ...after, updated_by: actor })
          .where('id', '=', found.id)
          .execute();
      }
      await deps.recordConfig(
        tx,
        actor,
        reminderSettingConfigEntityType,
        roundId,
        configDiffSchema.parse(diff),
      );
      const changes: AuditChanges = Object.fromEntries(
        (Object.keys(after) as (keyof Columns)[])
          .filter((column) => before?.[column] !== after[column])
          .map((column) => [
            `grants.reminder_setting.${column}`,
            { before: before?.[column] ?? null, after: after[column] },
          ]),
      );
      await context.audit.record({
        action: 'grants.reminder_setting.updated',
        entityId: roundId,
        changes,
      });
    }
    return (await read(tx, roundId)) ?? Promise.reject(deps.notFound());
  }

  /** What was done about each reminder, the latest first; one still waiting is not listed. */
  async function history(
    tx: Tx,
    column: 'application_id' | 'assignment_id',
    id: string,
  ): Promise<ReminderHistory> {
    const rows = await reminderDb(tx)
      .selectFrom('grants.reminder_email')
      .select(['kind', 'status', 'outcome_code', 'sent_at', 'last_attempt_at'])
      .where(column, '=', id)
      .where('status', '<>', 'pending')
      .orderBy('last_attempt_at', 'desc')
      .orderBy('id')
      .execute();
    return {
      reminders: rows.flatMap((row) =>
        row.status === 'pending' || (row.sent_at ?? row.last_attempt_at) === null
          ? []
          : [
              {
                kind: row.kind,
                at: (row.sent_at ?? (row.last_attempt_at as Date)).toISOString(),
                outcome: row.status,
                reason: row.outcome_code,
              },
            ],
      ),
    };
  }

  async function listSubmissionReminders({
    tx,
    input,
  }: Args<{ params: { submissionId: string } }>): Promise<ReminderHistory> {
    const { submissionId } = input.params;
    if ((await submittedApplication(tx, submissionId)) === undefined) throw deps.notFound();
    return history(tx, 'application_id', submissionId);
  }

  async function listAssignmentReminders({
    tx,
    input,
  }: Args<{ params: { assignmentId: string } }>): Promise<ReminderHistory> {
    const { assignmentId } = input.params;
    const found = await reminderDb(tx)
      .selectFrom('grants.assignment')
      .select('id')
      .where('id', '=', assignmentId)
      .executeTakeFirst();
    if (found === undefined) throw deps.notFound();
    return history(tx, 'assignment_id', assignmentId);
  }

  return {
    getReminderSetting,
    saveReminderSetting,
    listSubmissionReminders,
    listAssignmentReminders,
  };
}
