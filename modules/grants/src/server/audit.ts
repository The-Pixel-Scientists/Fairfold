// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party the module's audit events are about (ADR 0027): the applicant,
// from the application row, in the request's tenant transaction, so
// row-level security applies. See the party module's audit.ts for the rules
// the platform applies. Configuration events have no subject, and neither
// does a reviewer's pool: a reviewer is the actor of what they do, found
// through `actor_id`.

import { idSchema } from '@pixel-scientists/domain';
import type { SubjectRule } from '@pixel-scientists/party/server';

import type { GrantsAuditAction } from '../contracts/index.ts';
import type { Tx } from './programme/tables.ts';

type SubjectTables = {
  'grants.application': { id: string; applicant_person_id: string };
  'grants.assignment': { id: string; application_id: string };
  'grants.decision': { id: string; application_id: string };
  'grants.decision_email': { id: string; recipient_person_id: string };
  'grants.adjustment': { id: string; organisation_id: string };
};

const subjectDb = (tx: Tx) => tx.$extendTables<SubjectTables>();

async function applicantOf(tx: Tx, applicationId: string): Promise<string | null> {
  const row = await subjectDb(tx)
    .selectFrom('grants.application')
    .select('applicant_person_id')
    .where('id', '=', applicationId)
    .executeTakeFirst();
  return row?.applicant_person_id ?? null;
}

const application: SubjectRule = {
  subject: (tx, { entityId }) => applicantOf(tx, entityId),
};

const assignment: SubjectRule = {
  subject: async (tx, { entityId }) => {
    const row = await subjectDb(tx)
      .selectFrom('grants.assignment')
      .select('application_id')
      .where('id', '=', entityId)
      .executeTakeFirst();
    return row === undefined ? null : applicantOf(tx, row.application_id);
  },
};

/** The assignment is already deleted: its application is in the event's own changes. */
const removedAssignment: SubjectRule = {
  subject: (tx, { changes }) => {
    const before = changes?.['grants.assignment.application_id']?.before;
    const applicationId = idSchema.safeParse(before);
    return applicationId.success ? applicantOf(tx, applicationId.data) : Promise.resolve(null);
  },
};

const decision: SubjectRule = {
  subject: async (tx, { entityId }) => {
    const row = await subjectDb(tx)
      .selectFrom('grants.decision')
      .select('application_id')
      .where('id', '=', entityId)
      .executeTakeFirst();
    return row === undefined ? null : applicantOf(tx, row.application_id);
  },
};

const decisionEmail: SubjectRule = {
  subject: async (tx, { entityId }) =>
    (
      await subjectDb(tx)
        .selectFrom('grants.decision_email')
        .select('recipient_person_id')
        .where('id', '=', entityId)
        .executeTakeFirst()
    )?.recipient_person_id ?? null,
};

/** An adjustment is for an organisation; it is revoked, never deleted. */
const adjustment: SubjectRule = {
  subject: async (tx, { entityId }) =>
    (
      await subjectDb(tx)
        .selectFrom('grants.adjustment')
        .select('organisation_id')
        .where('id', '=', entityId)
        .executeTakeFirst()
    )?.organisation_id ?? null,
};

const configuration: SubjectRule = { none: 'Programme, round or form configuration.' };
const reviewerPool: SubjectRule = { none: 'A reviewer is the actor, found through actor_id.' };
const aggregate: SubjectRule = { none: 'Covers a whole round or the funder, not one person.' };

export const grantsSubjectRules: Readonly<Record<GrantsAuditAction, SubjectRule>> = {
  'grants.programme.created': configuration,
  'grants.programme.updated': configuration,
  'grants.programme.email_templates_changed': configuration,
  'grants.round.created': configuration,
  'grants.round.updated': configuration,
  'grants.round.stages_changed': configuration,
  'grants.stage.rubric_changed': configuration,
  'grants.form_version.created': configuration,
  'grants.form_version.updated': configuration,
  'grants.form_version.published': configuration,
  'grants.form_version.discarded': configuration,
  'grants.application.created': application,
  'grants.application.eligibility_checked': application,
  'grants.application.submitted': application,
  'grants.application.submitted_on_behalf': application,
  'grants.application.answers_saved_on_behalf': application,
  'grants.application.withdrawn': application,
  'grants.application.stage_changed': application,
  'grants.application.viewed': application,
  'grants.application.note_added': application,
  'grants.application.message_sent': application,
  'grants.application.messages_viewed': application,
  'grants.reviewer.added': reviewerPool,
  'grants.reviewer.removed': reviewerPool,
  'grants.assignment.created': assignment,
  'grants.assignment.removed': removedAssignment,
  'grants.assignment.conflict_declared': assignment,
  'grants.review.submitted': assignment,
  'grants.decision.recorded': decision,
  'grants.decision.changed': decision,
  'grants.decision.released': decision,
  'grants.decision_email.sent': decisionEmail,
  'grants.decision_email.failed': decisionEmail,
  'grants.decision_email.resent': decisionEmail,
  'grants.export.downloaded': aggregate,
  'grants.publisher_setting.changed': configuration,
  'grants.adjustment.granted': adjustment,
  'grants.adjustment.revoked': adjustment,
  // The entity is the application, since a withdrawal deletes the response;
  // the response id goes in the changes.
  'grants.monitoring.saved': application,
  'grants.monitoring.read': application,
  'grants.monitoring.withdrawn': application,
  'grants.monitoring.disclosed': application,
  'grants.reminder_setting.updated': configuration,
};
