// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending one reminder for the worker's reminder send job (ADR 0009, ADR
// 0020). The job holds an outbox row's id, and everything else is read here,
// in the job's own tenant transaction. This locks the row; leaves one already
// dealt with alone; checks again that grants and the round's setting are
// still on and that the draft is still open or the review still overdue;
// reads the recipient's address through the party contract, never keeping it;
// fills the row's template; sends; and marks the row sent, skipped or failed
// with a code, never a message. A connection that fails or times out is left
// for the job to try again, and the row stays waiting. Delivery is at least
// once: a crash between the mail server accepting an email and the commit
// sends it again on the retry. Nothing here changes an application, an
// assignment or a decision (architecture rule 9).

import { contactDetails, organisationName, personIdForUser } from '@pixel-scientists/party/server';

import {
  closingTimeWords,
  effectiveClosingTime,
  type ReminderKind,
  type ReminderReason,
} from '../../contracts/index.ts';
import type { MailSender } from '../decisions/context.ts';
import type { Tx } from '../programme/tables.ts';
import { reviewDue } from './due.ts';
import { renderReminder, type ReminderValues } from './render.ts';
import { reminderDb, type ReminderDb } from './tables.ts';

/** The failures worth another try: the mail server was not reached, or did not answer in time. */
const TRANSIENT = new Set(['connection_failed', 'timeout']);

export interface ReminderSendDependencies {
  readonly sender: MailSender;
  /** The applicant portal's origin, which a draft reminder links to. */
  readonly portalOrigin: string;
}

export interface ReminderSendJob {
  readonly reminderEmailId: string;
  readonly requestId: string;
  readonly now: Date;
}

/**
 * `done`: the row is sent, skipped, failed for good, or was already dealt with. `retry`: the mail
 * server could not be reached, so the job should be tried again. `missing`: no such row here.
 */
export type ReminderSendOutcome = 'done' | 'retry' | 'missing';

interface Row {
  readonly kind: ReminderKind;
  readonly occurrence: number;
  readonly application_id: string | null;
  readonly assignment_id: string | null;
  readonly recipient_person_id: string | null;
  readonly subject: string;
  readonly body: string;
}

type Ready =
  | { readonly skip: ReminderReason }
  | { readonly values: ReminderValues; readonly recipient: string };

async function draftValues(
  tx: Tx,
  db: ReminderDb,
  row: Row,
  now: Date,
  portalOrigin: string,
): Promise<{ skip: ReminderReason } | { values: Record<string, string> }> {
  const app = await db
    .selectFrom('grants.application as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .select([
      'a.status',
      'a.round_id',
      'a.organisation_id',
      'r.title as round_title',
      'r.closes_at',
      'p.title as programme_title',
    ])
    .where('a.id', '=', row.application_id ?? '')
    .executeTakeFirst();
  if (app === undefined || app.status !== 'draft') return { skip: 'not_needed' };

  const setting = await db
    .selectFrom('grants.reminder_setting')
    .select(['draft_enabled', 'draft_days_before_1', 'draft_days_before_2', 'draft_days_before_3'])
    .where('round_id', '=', app.round_id)
    .executeTakeFirst();
  const days = [
    setting?.draft_days_before_1,
    setting?.draft_days_before_2,
    setting?.draft_days_before_3,
  ];
  if (setting?.draft_enabled !== true || !days.includes(row.occurrence)) {
    return { skip: 'switched_off' };
  }

  const extensions = await db
    .selectFrom('grants.adjustment')
    .select(['round_id', 'organisation_id', 'application_id', 'closes_at', 'revoked_at'])
    .where('kind', '=', 'deadline_extension')
    .where('round_id', '=', app.round_id)
    .where('organisation_id', '=', app.organisation_id)
    .execute();
  const closes = effectiveClosingTime(
    {
      roundId: app.round_id,
      organisationId: app.organisation_id,
      id: row.application_id,
      roundClosesAt: app.closes_at,
    },
    extensions.map((e) => ({
      roundId: e.round_id,
      organisationId: e.organisation_id,
      applicationId: e.application_id,
      kind: 'deadline_extension',
      closesAt: e.closes_at,
      revoked: e.revoked_at !== null,
    })),
    now,
  );
  if (closes <= now) return { skip: 'closed' };
  return {
    values: {
      organisation_name: (await organisationName(tx, app.organisation_id)) ?? '',
      programme_title: app.programme_title,
      round_title: app.round_title,
      portal_link: portalOrigin,
      closing_time: closingTimeWords(closes, 'Europe/London'),
    },
  };
}

async function reviewValues(
  tx: Tx,
  db: ReminderDb,
  row: Row,
  now: Date,
): Promise<{ skip: ReminderReason } | { values: Record<string, string> }> {
  const found = await db
    .selectFrom('grants.assignment as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .innerJoin('app.membership as m', 'm.id', 'a.reviewer_membership_id')
    .select([
      'a.status',
      'a.round_id',
      'a.created_at',
      'r.title as round_title',
      'p.title as programme_title',
      'm.user_id',
      'm.status as member_status',
    ])
    .where('a.id', '=', row.assignment_id ?? '')
    .executeTakeFirst();
  if (found === undefined || found.status !== 'assigned') return { skip: 'not_needed' };

  const setting = await db
    .selectFrom('grants.reminder_setting')
    .select(['review_enabled', 'review_overdue_after_days', 'review_repeat_every_days'])
    .where('round_id', '=', found.round_id)
    .executeTakeFirst();
  if (setting?.review_enabled !== true) return { skip: 'switched_off' };
  const due = reviewDue(
    found.created_at,
    setting.review_overdue_after_days,
    setting.review_repeat_every_days,
  ).find(({ occurrence }) => occurrence === row.occurrence);
  if (due === undefined || due.dueAt > now) return { skip: 'not_needed' };

  // The reviewer's own person, never the sign-in address.
  if (
    found.member_status !== 'active' ||
    (await personIdForUser(tx, found.user_id)) !== row.recipient_person_id
  ) {
    return { skip: 'no_recipient' };
  }
  return { values: { programme_title: found.programme_title, round_title: found.round_title } };
}

async function prepare(
  tx: Tx,
  db: ReminderDb,
  row: Row,
  deps: ReminderSendDependencies,
  now: Date,
): Promise<Ready> {
  const grants = await db
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', 'grants')
    .executeTakeFirst();
  if (grants?.enabled !== true) return { skip: 'switched_off' };

  const facts =
    row.kind === 'draft_closing'
      ? await draftValues(tx, db, row, now, deps.portalOrigin)
      : await reviewValues(tx, db, row, now);
  if ('skip' in facts) return facts;

  const contact =
    row.recipient_person_id === null ? null : await contactDetails(tx, row.recipient_person_id);
  if (contact === null || contact.email === '') {
    return { skip: 'no_recipient' };
  }
  return {
    recipient: contact.email,
    values: { ...facts.values, given_name: contact.givenName ?? 'there' },
  };
}

export function sendReminder(deps: ReminderSendDependencies) {
  return async (tx: Tx, job: ReminderSendJob): Promise<ReminderSendOutcome> => {
    const db = reminderDb(tx);
    const row = await db
      .selectFrom('grants.reminder_email as e')
      .innerJoin('grants.email_template_version as t', 't.id', 'e.template_version_id')
      .select([
        'e.status',
        'e.kind',
        'e.occurrence',
        'e.application_id',
        'e.assignment_id',
        'e.recipient_person_id',
        't.subject',
        't.body',
      ])
      .where('e.id', '=', job.reminderEmailId)
      .forUpdate('e')
      .executeTakeFirst();
    if (row === undefined) return 'missing';
    if (row.status !== 'pending') return 'done';

    const finish = (status: 'sent' | 'skipped' | 'failed', code: ReminderReason | null) =>
      db
        .updateTable('grants.reminder_email')
        .set({ status, outcome_code: code })
        .where('id', '=', job.reminderEmailId)
        .execute();

    const ready = await prepare(tx, db, row, deps, job.now);
    if ('skip' in ready) {
      await finish('skipped', ready.skip);
      return 'done';
    }

    let email;
    try {
      email = renderReminder(row.kind, row, ready.values);
    } catch {
      await finish('failed', 'delivery_failed');
      return 'done';
    }
    const sent = await deps.sender.send({
      to: ready.recipient,
      subject: email.subject,
      text: email.body,
      requestId: job.requestId,
    });
    if (!sent.sent && TRANSIENT.has(sent.code)) return 'retry';
    await (sent.sent ? finish('sent', null) : finish('failed', 'delivery_failed'));
    return 'done';
  };
}
