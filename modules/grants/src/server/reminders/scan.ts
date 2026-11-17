// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reminder scan for one tenant (ADR 0009, ADR 0020), run by the worker in
// that tenant's transaction. It finds the drafts and reviews whose reminders
// have fallen due under each round's setting and writes one outbox row for
// each, then queues the send job for it in the same transaction. The unique
// index on subject, kind and occurrence makes a repeated scan, or a job
// delivered twice, add nothing. Reminders only remind (rule 9): this reads
// applications, assignments and adjustments and writes the outbox alone.

import { peopleByUserIds } from '@pixel-scientists/party/server';

import {
  effectiveClosingTime,
  type AdjustmentTiming,
  type ReminderKind,
} from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { draftDue, plan, reviewDue } from './due.ts';
import { reminderDb, type ReminderDb } from './tables.ts';

/** The database's clock, which closing times are compared with. */
export async function databaseNow(tx: Tx): Promise<Date> {
  const { now } = await tx
    .selectNoFrom((eb) => eb.fn<Date>('now', []).as('now'))
    .executeTakeFirstOrThrow();
  return now;
}

/** Queues the job that sends one outbox row's reminder, in the same transaction. */
export type QueueReminder = (tx: Tx, reminderEmailId: string) => Promise<void>;

interface Subject {
  readonly kind: ReminderKind;
  readonly id: string;
  readonly recipientPersonId: string | null;
  readonly templateVersionId: string;
}

/** Writes the row for each occurrence not yet written: the one to send, and the earlier ones superseded. */
async function record(
  db: ReminderDb,
  tx: Tx,
  queue: QueueReminder,
  subject: Subject,
  chosen: { readonly send: number | null; readonly superseded: readonly number[] },
): Promise<number> {
  let queued = 0;
  const occurrences = [...chosen.superseded, ...(chosen.send === null ? [] : [chosen.send])];
  for (const occurrence of occurrences) {
    const row = await db
      .insertInto('grants.reminder_email')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        kind: subject.kind,
        application_id: subject.kind === 'draft_closing' ? subject.id : null,
        assignment_id: subject.kind === 'review_overdue' ? subject.id : null,
        recipient_person_id: subject.recipientPersonId,
        template_version_id: subject.templateVersionId,
        occurrence,
      }))
      .onConflict((conflict) => conflict.doNothing())
      .returning('id')
      .executeTakeFirst();
    if (row === undefined) continue;
    if (occurrence === chosen.send) {
      await queue(tx, row.id);
      queued++;
    } else {
      await db
        .updateTable('grants.reminder_email')
        .set({ status: 'skipped', outcome_code: 'superseded' })
        .where('id', '=', row.id)
        .execute();
    }
  }
  return queued;
}

/** Writes and queues every reminder due at `now`; answers how many sends it queued. */
export async function scanReminders(tx: Tx, now: Date, queue: QueueReminder): Promise<number> {
  const db = reminderDb(tx);
  // A module that is off keeps its data and sends nothing (ADR 0024).
  const grants = await db
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', 'grants')
    .executeTakeFirst();
  if (grants?.enabled !== true) return 0;

  const settings = await loadSettings(db);
  return (
    (await scanDrafts(tx, db, now, queue, settings)) +
    (await scanReviews(tx, db, now, queue, settings))
  );
}

const loadSettings = (db: ReminderDb) =>
  db
    .selectFrom('grants.reminder_setting')
    .selectAll()
    .where((eb) => eb.or([eb('draft_enabled', '=', true), eb('review_enabled', '=', true)]))
    .orderBy('id')
    .execute();

type Settings = Awaited<ReturnType<typeof loadSettings>>;

async function scanDrafts(
  tx: Tx,
  db: ReminderDb,
  now: Date,
  queue: QueueReminder,
  settings: Settings,
): Promise<number> {
  const drafting = settings.filter((s) => s.draft_enabled && s.draft_template_version_id !== null);
  if (drafting.length === 0) return 0;
  const rounds = drafting.map((s) => s.round_id);
  const applications = await db
    .selectFrom('grants.application as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .select(['a.id', 'a.round_id', 'a.organisation_id', 'a.applicant_person_id', 'r.closes_at'])
    .where('a.status', '=', 'draft')
    .where('a.round_id', 'in', rounds)
    // An erased applicant's draft stays a draft, but nothing is sent to them, and the outbox refuses their id.
    .where((eb) =>
      eb.not(
        eb.fn<boolean>('party.is_erased', [
          eb.fn('app.current_tenant_id', []),
          eb.ref('a.applicant_person_id'),
        ]),
      ),
    )
    .orderBy('a.id')
    .execute();
  const extensions = await db
    .selectFrom('grants.adjustment')
    .select(['round_id', 'organisation_id', 'application_id', 'closes_at', 'revoked_at'])
    .where('kind', '=', 'deadline_extension')
    .where('round_id', 'in', rounds)
    .execute();
  const timing: AdjustmentTiming[] = extensions.map((e) => ({
    roundId: e.round_id,
    organisationId: e.organisation_id,
    applicationId: e.application_id,
    kind: 'deadline_extension',
    closesAt: e.closes_at,
    revoked: e.revoked_at !== null,
  }));

  let queued = 0;
  for (const app of applications) {
    const setting = drafting.find((s) => s.round_id === app.round_id);
    if (setting === undefined || setting.draft_template_version_id === null) continue;
    const closes = effectiveClosingTime(
      {
        roundId: app.round_id,
        organisationId: app.organisation_id,
        id: app.id,
        roundClosesAt: app.closes_at,
      },
      timing,
      now,
    );
    if (closes <= now) continue;
    const days = [
      setting.draft_days_before_1,
      setting.draft_days_before_2,
      setting.draft_days_before_3,
    ].filter((d) => d !== null);
    queued += await record(
      db,
      tx,
      queue,
      {
        kind: 'draft_closing',
        id: app.id,
        recipientPersonId: app.applicant_person_id,
        templateVersionId: setting.draft_template_version_id,
      },
      plan(draftDue(closes, days), now),
    );
  }
  return queued;
}

async function scanReviews(
  tx: Tx,
  db: ReminderDb,
  now: Date,
  queue: QueueReminder,
  settings: Settings,
): Promise<number> {
  const reviewing = settings.filter(
    (s) => s.review_enabled && s.review_template_version_id !== null,
  );
  if (reviewing.length === 0) return 0;
  const assignments = await db
    .selectFrom('grants.assignment as a')
    .innerJoin('app.membership as m', 'm.id', 'a.reviewer_membership_id')
    .select(['a.id', 'a.round_id', 'a.created_at', 'm.user_id', 'm.status as member_status'])
    .where('a.status', '=', 'assigned')
    .where(
      'a.round_id',
      'in',
      reviewing.map((s) => s.round_id),
    )
    .orderBy('a.id')
    .execute();
  // A reviewer who is no longer an active member gets a row with no recipient, skipped when sent.
  const people = await peopleByUserIds(
    tx,
    assignments.filter((a) => a.member_status === 'active').map((a) => a.user_id),
  );

  let queued = 0;
  for (const assignment of assignments) {
    const setting = reviewing.find((s) => s.round_id === assignment.round_id);
    if (setting === undefined || setting.review_template_version_id === null) continue;
    queued += await record(
      db,
      tx,
      queue,
      {
        kind: 'review_overdue',
        id: assignment.id,
        recipientPersonId:
          assignment.member_status === 'active'
            ? (people.get(assignment.user_id)?.personId ?? null)
            : null,
        templateVersionId: setting.review_template_version_id,
      },
      plan(
        reviewDue(
          assignment.created_at,
          setting.review_overdue_after_days,
          setting.review_repeat_every_days,
        ),
        now,
      ),
    );
  }
  return queued;
}
