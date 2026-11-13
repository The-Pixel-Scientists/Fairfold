// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the grants schema. A programme's title and
// summary, and a round's title, dates and award range, are public:
// applicants see them. The rest of the set-up (descriptions, budgets, late
// policies, stages, rubrics, email templates and application forms) is
// internal, as are ids, statuses and actors. An application's answers are
// classified field by field from the form version it pinned (ADR 0027); the
// column itself is special category, the most any answer can be, so a
// reader that does not know per-field columns leaves it out. Its links to
// people and organisations are internal ids, as are its
// statuses, times, late flag, eligibility outcomes and file links (ADR
// 0047). Reviewer pools, assignments, conflict declarations and scores are
// internal, but for a score's comment, which is personal: a reviewer's
// words about an applicant. Decisions (outcome, amount and dates included,
// since a tenant publishes awards through 360Giving by its own choice) and
// their emails' links, statuses and error codes are internal; the
// publisher's 360Giving details are public. Everything is kept while the
// tenant is a customer: applications, scores and sent emails refer to the
// set-up, an email row as long as its decision, since it records who was
// told what and when (ADR 0020), and erasure anonymises a person in place
// (ADR 0017). A reasonable adjustment is kept with the round it concerns;
// its reason codes are special category, since a code such as access_needs
// can reveal health. An equality monitoring response's answers and consent
// (ADR 0032) are special category, and the row is deleted when consent is
// withdrawn. For now it is otherwise kept as long as its application:
// S11-102's retention functions will enforce the tenant policy
// grants.monitoring (24 months from the round's close for monitoring) once
// that policy has a target.

import type {
  ClassificationRegistry,
  FieldClassification,
  ProcessingEntry,
  ProcessingRegistry,
  SubjectPathRegistry,
} from '../classification.ts';

const internal: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};
const shown: FieldClassification = {
  sensitivity: 'public',
  retention: { kind: 'tenant_lifetime' },
};
const personal: FieldClassification = {
  sensitivity: 'personal',
  retention: { kind: 'tenant_lifetime' },
};
const special: FieldClassification = {
  sensitivity: 'special_category',
  retention: { kind: 'tenant_lifetime' },
};

const keyAndActors = {
  tenant_id: internal,
  id: internal,
  created_at: internal,
  created_by: internal,
  updated_at: internal,
  updated_by: internal,
} as const;

export const grants = {
  'grants.programme': {
    ...keyAndActors,
    title: shown,
    summary: shown,
    description: internal,
    status: internal,
  },
  'grants.round': {
    ...keyAndActors,
    programme_id: internal,
    title: shown,
    opens_at: shown,
    closes_at: shown,
    timezone: shown,
    budget_minor: internal,
    award_min_minor: shown,
    award_max_minor: shown,
    currency: shown,
    late_policy: internal,
  },
  'grants.stage': {
    ...keyAndActors,
    round_id: internal,
    name: internal,
    position: internal,
  },
  'grants.rubric_criterion': {
    ...keyAndActors,
    stage_id: internal,
    label: internal,
    guidance: internal,
    weight: internal,
    scale_min: internal,
    scale_max: internal,
    position: internal,
  },
  'grants.email_template_version': {
    tenant_id: internal,
    id: internal,
    programme_id: internal,
    outcome: internal,
    version: internal,
    subject: internal,
    body: internal,
    created_at: internal,
    created_by: internal,
  },
  'grants.form_version': {
    ...keyAndActors,
    round_id: internal,
    version: internal,
    status: internal,
    definition: internal,
    published_at: internal,
    published_by: internal,
  },
  'grants.application': {
    ...keyAndActors,
    round_id: internal,
    form_version_id: internal,
    applicant_person_id: internal,
    organisation_id: internal,
    status: internal,
    answers: {
      sensitivity: 'special_category',
      retention: { kind: 'tenant_lifetime' },
      perField: {
        versionColumn: 'form_version_id',
        definition: { table: 'grants.form_version', column: 'definition' },
      },
    },
    answers_version: internal,
    stage_id: internal,
    submitted_at: internal,
    submitted_late: internal,
    withdrawn_at: internal,
    organisation_snapshot_id: internal,
    submission_route: internal,
    submitted_by: internal,
  },
  'grants.adjustment': {
    tenant_id: internal,
    id: internal,
    round_id: internal,
    organisation_id: internal,
    application_id: internal,
    kind: internal,
    closes_at: internal,
    reason_code: special,
    granted_by: internal,
    granted_at: internal,
    revoked_by: internal,
    revoked_at: internal,
    revoke_reason_code: special,
  },
  'grants.monitoring_response': {
    tenant_id: internal,
    id: internal,
    round_id: internal,
    application_id: internal,
    form_version_id: internal,
    answers: special,
    consent_given_at: special,
    privacy_notice_version: special,
    created_at: internal,
  },
  'grants.eligibility_result': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    form_version_id: internal,
    outcome: internal,
    stopping_field_id: internal,
    checked_at: internal,
    checked_by: internal,
  },
  'grants.stage_transition': {
    tenant_id: internal,
    id: internal,
    round_id: internal,
    application_id: internal,
    from_stage_id: internal,
    to_stage_id: internal,
    moved_at: internal,
    moved_by: internal,
  },
  'grants.application_file': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    file_id: internal,
    field_id: internal,
    created_by: internal,
    created_at: internal,
  },
  'grants.reviewer': {
    tenant_id: internal,
    id: internal,
    round_id: internal,
    membership_id: internal,
    added_at: internal,
    added_by: internal,
  },
  'grants.assignment': {
    ...keyAndActors,
    round_id: internal,
    application_id: internal,
    reviewer_membership_id: internal,
    stage_id: internal,
    status: internal,
    submitted_at: internal,
  },
  'grants.conflict_declaration': {
    tenant_id: internal,
    id: internal,
    assignment_id: internal,
    declared_at: internal,
    declared_by: internal,
  },
  'grants.score': {
    ...keyAndActors,
    assignment_id: internal,
    stage_id: internal,
    criterion_id: internal,
    score: internal,
    comment: personal,
  },
  'grants.decision': {
    ...keyAndActors,
    application_id: internal,
    outcome: internal,
    amount_minor: internal,
    currency: internal,
    recorded_at: internal,
    recorded_by: internal,
    released_at: internal,
    released_by: internal,
  },
  'grants.decision_email': {
    ...keyAndActors,
    decision_id: internal,
    recipient_person_id: internal,
    template_version_id: internal,
    status: internal,
    error_code: internal,
    attempts: internal,
    last_attempt_at: internal,
    sent_at: internal,
  },
  'grants.publisher_setting': {
    ...keyAndActors,
    funder_identifier: shown,
    funder_name: shown,
    identifier_prefix: shown,
  },
  // Join tables between an application and its platform notes and thread
  // (ADR 0030): ids and times, kept with the application.
  'grants.application_note': {
    tenant_id: internal,
    id: internal,
    note_id: internal,
    application_id: internal,
    created_at: internal,
  },
  'grants.application_message': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    thread_id: internal,
    created_at: internal,
  },
  // An outbox row for telling an applicant about a message, kept as long as a
  // decision email. The recipient is cleared on erasure (ADR 0027).
  'grants.message_notification': {
    tenant_id: internal,
    id: internal,
    message_id: internal,
    recipient_person_id: personal,
    template_version_id: internal,
    status: internal,
    error_code: internal,
    sent_at: internal,
    created_at: internal,
  },
  // Triage (0059): ids, membership ids, colour tokens, flags and times. An
  // owner and an applied label are kept as long as their application. The
  // label set and saved views are tenant configuration, kept while the tenant
  // is a customer; their names must not name applicants. A view's filter
  // holds the submissions list's ids, enums and flags, never free text. Label
  // names, view names and stored filters never go in an audit value.
  // S11-102's retention functions enforce these rules.
  'grants.application_owner': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    membership_id: internal,
    assigned_by: internal,
    assigned_at: internal,
  },
  'grants.label': {
    ...keyAndActors,
    name: internal,
    colour: internal,
    archived: internal,
  },
  'grants.application_label': {
    tenant_id: internal,
    id: internal,
    application_id: internal,
    label_id: internal,
    added_by: internal,
    added_at: internal,
  },
  'grants.saved_view': {
    ...keyAndActors,
    name: internal,
    filter: internal,
    sort: internal,
    columns: internal,
  },
  // Reminders (0060, 0061 and 0068): ids, switches, whole days, versions, kinds,
  // statuses, codes and times, all of which may be audit values. A round's
  // setting is configuration about no subject, kept with its round. An outbox
  // row holds no address or text; it is kept as long as the application or
  // assignment it concerns, like a decision email (ADR 0020), and erasure
  // clears its recipient (ADR 0027). S11-102's retention functions enforce
  // these rules.
  'grants.reminder_setting': {
    ...keyAndActors,
    round_id: internal,
    draft_enabled: internal,
    draft_days_before_1: internal,
    draft_days_before_2: internal,
    draft_days_before_3: internal,
    draft_template_version_id: internal,
    draft_template_kind: internal,
    review_enabled: internal,
    review_overdue_after_days: internal,
    review_repeat_every_days: internal,
    review_template_version_id: internal,
    review_template_kind: internal,
    version: internal,
  },
  'grants.reminder_email': {
    tenant_id: internal,
    id: internal,
    kind: internal,
    application_id: internal,
    assignment_id: internal,
    recipient_person_id: internal,
    template_version_id: internal,
    occurrence: internal,
    status: internal,
    outcome_code: internal,
    attempts: internal,
    last_attempt_at: internal,
    sent_at: internal,
    created_at: internal,
  },
} satisfies ClassificationRegistry;

const throughApplication = {
  kind: 'join',
  column: 'application_id',
  table: 'grants.application',
} as const;

/**
 * Each table's path to the party its rows are about (ADR 0027): an
 * application's applicant, reached from the records about the application,
 * and a decision email's recipient.
 */
export const grantsSubjects: SubjectPathRegistry = {
  'grants.application': { kind: 'party', column: 'applicant_person_id' },
  'grants.adjustment': { kind: 'party', column: 'organisation_id' },
  'grants.monitoring_response': throughApplication,
  'grants.eligibility_result': throughApplication,
  'grants.stage_transition': throughApplication,
  'grants.application_file': throughApplication,
  'grants.assignment': throughApplication,
  'grants.score': { kind: 'join', column: 'assignment_id', table: 'grants.assignment' },
  'grants.decision': throughApplication,
  'grants.decision_email': { kind: 'party', column: 'recipient_person_id' },
  'grants.application_note': throughApplication,
  'grants.application_message': throughApplication,
  'grants.message_notification': { kind: 'party', column: 'recipient_person_id' },
  'grants.application_owner': throughApplication,
  'grants.application_label': throughApplication,
  'grants.reminder_email': { kind: 'party', column: 'recipient_person_id' },
  // grants.label, grants.saved_view and grants.reminder_setting are
  // configuration, about no subject.
};

const stored = ['hosting', 'backup'] as const;

/** A programme's set-up, holding no person's data. */
const setUp: ProcessingEntry = {
  purpose: 'programme_administration',
  legalBasis: 'contract',
  processors: stored,
  dataSubjects: [],
  dataCategories: [],
};
const application = (
  purpose: ProcessingEntry['purpose'],
  legalBasis: ProcessingEntry['legalBasis'],
  dataSubjects: ProcessingEntry['dataSubjects'] = ['applicant'],
): ProcessingEntry => ({
  purpose,
  legalBasis,
  processors: stored,
  dataSubjects,
  dataCategories: ['other'],
});
const reviewerSetUp: ProcessingEntry = { ...setUp, purpose: 'assessment' };
/** The release email carries the outcome and any award to the mail provider. */
const emailedDecision: ProcessingEntry = {
  ...application('decisions', 'contract'),
  processors: [...stored, 'email'],
};

export const grantsProcessing: ProcessingRegistry<typeof grants> = {
  'grants.programme': setUp,
  'grants.round': setUp,
  'grants.stage': setUp,
  'grants.rubric_criterion': setUp,
  'grants.email_template_version': setUp,
  'grants.form_version': setUp,
  // Answers are classified per field with a special category ceiling. Special
  // category answers are given under explicit consent, as for monitoring
  // (ADR 0032).
  'grants.application': {
    purpose: 'grant_applications',
    legalBasis: 'contract',
    article9Condition: 'explicit_consent',
    processors: stored,
    dataSubjects: ['applicant', 'applicant_contact'],
    dataCategories: ['identity', 'contact', 'other'],
  },
  // A reasonable adjustment is a duty under the Equality Act 2010, not
  // something a person consents to.
  'grants.adjustment': {
    ...application('grant_applications', 'legal_obligation', ['applicant', 'applicant_contact']),
    article9Condition: 'substantial_public_interest',
  },
  // Explicit consent, as ADR 0032 decides.
  'grants.monitoring_response': {
    ...application('grant_applications', 'consent'),
    article9Condition: 'explicit_consent',
  },
  'grants.eligibility_result': application('assessment', 'contract'),
  'grants.stage_transition': application('assessment', 'contract'),
  'grants.application_file': application('grant_applications', 'contract'),
  'grants.reviewer': reviewerSetUp,
  'grants.assignment': application('assessment', 'legitimate_interests', ['applicant', 'reviewer']),
  'grants.conflict_declaration': reviewerSetUp,
  'grants.score': application('assessment', 'legitimate_interests', ['applicant', 'reviewer']),
  'grants.decision': emailedDecision,
  'grants.decision_email': emailedDecision,
  'grants.publisher_setting': setUp,
  'grants.application_note': application('grant_applications', 'contract', ['applicant']),
  'grants.application_message': application('grant_applications', 'contract'),
  // The notification names the message's thread to the mail provider.
  'grants.message_notification': {
    ...application('grant_applications', 'contract'),
    processors: [...stored, 'email'],
  },
  'grants.application_owner': application('assessment', 'contract'),
  'grants.label': setUp,
  'grants.application_label': application('assessment', 'contract'),
  'grants.saved_view': setUp,
  'grants.reminder_setting': setUp,
  // The reminder names its draft or review to the mail provider.
  'grants.reminder_email': {
    ...application('grant_applications', 'legitimate_interests', ['applicant', 'reviewer']),
    processors: [...stored, 'email'],
  },
};
