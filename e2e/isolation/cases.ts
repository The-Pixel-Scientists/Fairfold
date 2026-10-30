// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One case for every console and portal route: the request that names the
// first funder's records, as someone who must not reach them would send it.
// Each case is one of three kinds.
//
//   record  The path names a record, and so does the body or query where it
//           has one. Another funder's, another applicant's or another
//           reviewer's call must find nothing: 404, never data.
//   list    The route reads or writes the caller's own funder or person, and
//           the request can still name the first funder's ids. The answer
//           may be empty, or 404, but must hold nothing of theirs.
//   own     Nothing in the request can name a record, and the route changes
//           only what belongs to the caller. It is not called: calling it as
//           the second funder would change the second funder.
//
// A route with no case fails the walk, so a new route cannot go in unchecked.

import { budgetForm } from '../../apps/console/e2e/forms-builder-table-file-steps.ts';
import { accountsPdf } from '../fixtures/files.ts';
import type { Call } from '../support/api.ts';

/** The ids of the first funder's records that the walk names, found by the steps before. */
export type Fixture = {
  programmeId: string;
  roundId: string;
  formVersionId: string;
  intakeStageId: string;
  reviewStageId: string;
  /** Applicant one's application, which is also the submission staff see. */
  applicationId: string;
  /** The accounts file attached to it, and the question it answers. */
  fileId: string;
  fieldId: string;
  /** Applicant one's organisation and the person who is its contact. */
  organisationId: string;
  personId: string;
  /** Reviewer one's membership, assignment and a criterion they score. */
  reviewerMembershipId: string;
  assignmentId: string;
  criterionId: string;
  /** A pending invitation. */
  invitationId: string;
};

export interface Named extends Call {
  /** Values for the path's `:name` segments. */
  params?: Record<string, string>;
}

export type Case =
  { kind: 'record' | 'list'; call: (f: Fixture) => Named } | { kind: 'own'; why: string };

const record = (call: (f: Fixture) => Named): Case => ({ kind: 'record', call });
const list = (call: (f: Fixture) => Named): Case => ({ kind: 'list', call });
const own = (why: string): Case => ({ kind: 'own', why });

const OWN_FUNDER = 'Acts only on the caller’s own funder.';
const OWN_PERSON = 'Acts only on the caller’s own person.';

const money = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' });
const programme = { title: 'Probe', summary: 'Probe.', description: '', status: 'draft' };
const round = {
  title: 'Probe',
  opensAt: '2030-01-01T09:00',
  closesAt: '2030-02-01T09:00',
  budget: money(10_000),
  awardMinimum: money(100),
  awardMaximum: money(1000),
  latePolicy: 'refuse',
};
const template = { subject: 'Probe', body: 'Probe.' };
const organisation = {
  name: 'Probe',
  legalForm: 'registered_charity',
  identifiers: [],
  registeredAddress: { line1: '1 Probe Road', town: 'Probe', postcode: 'EA1 2ST' },
};
const score = (f: Fixture) => [{ criterionId: f.criterionId, score: 1, comment: '' }];

export const cases: Record<string, Case> = {
  // Programmes, rounds, stages and forms.
  'POST /console/programmes': own(OWN_FUNDER),
  'GET /console/programmes': list(() => ({})),
  'GET /console/programmes/:programmeId': record((f) => ({
    params: { programmeId: f.programmeId },
  })),
  'PUT /console/programmes/:programmeId': record((f) => ({
    params: { programmeId: f.programmeId },
    json: programme,
  })),
  'GET /console/programmes/:programmeId/history': record((f) => ({
    params: { programmeId: f.programmeId },
  })),
  'GET /console/programmes/:programmeId/rounds': record((f) => ({
    params: { programmeId: f.programmeId },
  })),
  'POST /console/programmes/:programmeId/rounds': record((f) => ({
    params: { programmeId: f.programmeId },
    json: round,
  })),
  'GET /console/programmes/:programmeId/email-templates': record((f) => ({
    params: { programmeId: f.programmeId },
  })),
  'PUT /console/programmes/:programmeId/email-templates': record((f) => ({
    params: { programmeId: f.programmeId },
    json: { accepted: template, waitlisted: template, declined: template },
  })),
  'GET /console/rounds/:roundId': record((f) => ({ params: { roundId: f.roundId } })),
  'PUT /console/rounds/:roundId': record((f) => ({ params: { roundId: f.roundId }, json: round })),
  'GET /console/rounds/:roundId/history': record((f) => ({ params: { roundId: f.roundId } })),
  'GET /console/rounds/:roundId/stages': record((f) => ({ params: { roundId: f.roundId } })),
  'PUT /console/rounds/:roundId/stages': record((f) => ({
    params: { roundId: f.roundId },
    json: { stages: [{ name: 'Intake' }] },
  })),
  'PUT /console/stages/:stageId/rubric': record((f) => ({
    params: { stageId: f.reviewStageId },
    json: { criteria: [{ label: 'Probe', weight: 1 }] },
  })),
  'GET /console/rounds/:roundId/form-versions': record((f) => ({ params: { roundId: f.roundId } })),
  'POST /console/rounds/:roundId/form-versions': record((f) => ({
    params: { roundId: f.roundId },
  })),
  'GET /console/form-versions/:formVersionId': record((f) => ({
    params: { formVersionId: f.formVersionId },
  })),
  'PUT /console/form-versions/:formVersionId/definition': record((f) => ({
    params: { formVersionId: f.formVersionId },
    json: { definition: budgetForm },
  })),
  'POST /console/form-versions/:formVersionId/publish': record((f) => ({
    params: { formVersionId: f.formVersionId },
  })),
  'DELETE /console/form-versions/:formVersionId': record((f) => ({
    params: { formVersionId: f.formVersionId },
  })),

  // The applicant's own routes.
  'GET /portal/rounds': list(() => ({})),
  'GET /portal/rounds/:roundId': record((f) => ({ params: { roundId: f.roundId } })),
  'POST /portal/rounds/:roundId/applications': record((f) => ({
    params: { roundId: f.roundId },
    json: { organisationId: f.organisationId },
  })),
  'GET /portal/applications': list(() => ({})),
  'GET /portal/applications/:applicationId': record((f) => ({
    params: { applicationId: f.applicationId },
  })),
  'PUT /portal/applications/:applicationId/answers': record((f) => ({
    params: { applicationId: f.applicationId },
    json: { basedOn: 1, answers: {} },
  })),
  'POST /portal/applications/:applicationId/eligibility-check': record((f) => ({
    params: { applicationId: f.applicationId },
  })),
  'POST /portal/applications/:applicationId/submit': record((f) => ({
    params: { applicationId: f.applicationId },
    json: { basedOn: 1 },
  })),
  'POST /portal/applications/:applicationId/withdraw': record((f) => ({
    params: { applicationId: f.applicationId },
  })),
  'GET /portal/applications/:applicationId/files': record((f) => ({
    params: { applicationId: f.applicationId },
  })),
  'POST /portal/applications/:applicationId/fields/:fieldId/files': record((f) => ({
    params: { applicationId: f.applicationId, fieldId: f.fieldId },
    file: { name: 'probe.pdf', bytes: accountsPdf() },
  })),
  'GET /portal/applications/:applicationId/files/:fileId': record((f) => ({
    params: { applicationId: f.applicationId, fileId: f.fileId },
  })),
  'DELETE /portal/applications/:applicationId/files/:fileId': record((f) => ({
    params: { applicationId: f.applicationId, fileId: f.fileId },
  })),
  'GET /portal/profile': own(OWN_PERSON),
  'PUT /portal/profile': own(OWN_PERSON),
  'POST /portal/profile/consents': own(OWN_PERSON),
  'GET /portal/organisations': list(() => ({})),
  'POST /portal/organisations': own(OWN_PERSON),
  'GET /portal/organisations/:organisationId': record((f) => ({
    params: { organisationId: f.organisationId },
  })),
  'PUT /portal/organisations/:organisationId': record((f) => ({
    params: { organisationId: f.organisationId },
    json: organisation,
  })),

  // Triage.
  'GET /console/submissions': list((f) => ({ query: { roundId: f.roundId } })),
  'GET /console/submissions/:submissionId': record((f) => ({
    params: { submissionId: f.applicationId },
  })),
  'GET /console/submissions/:submissionId/files': record((f) => ({
    params: { submissionId: f.applicationId },
  })),
  'GET /console/submissions/:submissionId/files/:fileId': record((f) => ({
    params: { submissionId: f.applicationId, fileId: f.fileId },
  })),
  'POST /console/stages/:stageId/submissions': record((f) => ({
    params: { stageId: f.reviewStageId },
    json: { submissionIds: [f.applicationId] },
  })),

  // Assessment.
  'GET /console/rounds/:roundId/reviewers': record((f) => ({ params: { roundId: f.roundId } })),
  'GET /console/rounds/:roundId/reviewer-candidates': record((f) => ({
    params: { roundId: f.roundId },
  })),
  'POST /console/rounds/:roundId/reviewers': record((f) => ({
    params: { roundId: f.roundId },
    json: { membershipIds: [f.reviewerMembershipId] },
  })),
  'DELETE /console/rounds/:roundId/reviewers/:membershipId': record((f) => ({
    params: { roundId: f.roundId, membershipId: f.reviewerMembershipId },
  })),
  'POST /console/stages/:stageId/assignments': record((f) => ({
    params: { stageId: f.reviewStageId },
    json: { submissionIds: [f.applicationId], membershipIds: [f.reviewerMembershipId] },
  })),
  'POST /console/stages/:stageId/assignments/automatic': record((f) => ({
    params: { stageId: f.reviewStageId },
    json: { submissionIds: [f.applicationId], reviewersPerSubmission: 1 },
  })),
  'GET /console/submissions/:submissionId/assignments': record((f) => ({
    params: { submissionId: f.applicationId },
  })),
  'DELETE /console/assignments/:assignmentId': record((f) => ({
    params: { assignmentId: f.assignmentId },
  })),
  'GET /console/submissions/:submissionId/scores': record((f) => ({
    params: { submissionId: f.applicationId },
  })),
  'GET /console/rounds/:roundId/score-spread': record((f) => ({ params: { roundId: f.roundId } })),
  'GET /console/reviews': list(() => ({})),
  'GET /console/reviews/:assignmentId': record((f) => ({
    params: { assignmentId: f.assignmentId },
  })),
  'POST /console/reviews/:assignmentId/conflict': record((f) => ({
    params: { assignmentId: f.assignmentId },
  })),
  'PUT /console/reviews/:assignmentId/scores': record((f) => ({
    params: { assignmentId: f.assignmentId },
    json: { scores: score(f) },
  })),
  'POST /console/reviews/:assignmentId/submit': record((f) => ({
    params: { assignmentId: f.assignmentId },
    json: { scores: score(f) },
  })),

  // Decisions.
  'GET /console/rounds/:roundId/decisions': record((f) => ({ params: { roundId: f.roundId } })),
  'PUT /console/submissions/:submissionId/decision': record((f) => ({
    params: { submissionId: f.applicationId },
    json: { outcome: 'declined' },
  })),
  'POST /console/rounds/:roundId/decisions': record((f) => ({
    params: { roundId: f.roundId },
    json: { decisions: [{ submissionId: f.applicationId, decision: { outcome: 'declined' } }] },
  })),
  'GET /console/submissions/:submissionId/decision/email': record((f) => ({
    params: { submissionId: f.applicationId },
  })),
  'POST /console/rounds/:roundId/decisions/release': record((f) => ({
    params: { roundId: f.roundId },
    json: { release: 'chosen', submissionIds: [f.applicationId] },
  })),
  'POST /console/rounds/:roundId/decision-emails/send': record((f) => ({
    params: { roundId: f.roundId },
  })),

  // Data out.
  'GET /console/exports/360giving': list((f) => ({ query: { roundId: f.roundId } })),
  'GET /console/exports/360giving/publisher': list(() => ({})),
  'PUT /console/exports/360giving/publisher': own(OWN_FUNDER),
  'GET /console/warehouse/snapshot': list(() => ({})),

  // People and organisations, read by staff.
  'GET /console/organisations': list(() => ({ query: { search: 'Eastmere' } })),
  'GET /console/organisations/:organisationId': record((f) => ({
    params: { organisationId: f.organisationId },
  })),
  'GET /console/people/:personId': record((f) => ({ params: { personId: f.personId } })),

  // Settings, team and the audit log.
  'GET /console/settings': list(() => ({})),
  'PUT /console/settings': own(OWN_FUNDER),
  'GET /console/settings/theme': list(() => ({})),
  'PUT /console/settings/theme': own(OWN_FUNDER),
  'PUT /console/settings/theme/tokens': own(OWN_FUNDER),
  'DELETE /console/settings/theme/tokens': own(OWN_FUNDER),
  'PUT /console/settings/theme/logo': own(OWN_FUNDER),
  'DELETE /console/settings/theme/logo': own(OWN_FUNDER),
  'GET /console/settings/modules': list(() => ({})),
  'PATCH /console/settings/modules': own(OWN_FUNDER),
  'GET /console/team': list(() => ({})),
  'POST /console/team/invitations': own(OWN_FUNDER),
  'DELETE /console/team/invitations/:invitationId': record((f) => ({
    params: { invitationId: f.invitationId },
  })),
  'PUT /console/team/members/:membershipId/roles': record((f) => ({
    params: { membershipId: f.reviewerMembershipId },
    json: { roles: ['tenant_admin'] },
  })),
  'POST /console/team/members/:membershipId/suspend': record((f) => ({
    params: { membershipId: f.reviewerMembershipId },
  })),
  'POST /console/team/members/:membershipId/reinstate': record((f) => ({
    params: { membershipId: f.reviewerMembershipId },
  })),
  'DELETE /console/team/members/:membershipId': record((f) => ({
    params: { membershipId: f.reviewerMembershipId },
  })),
  'GET /console/audit-events': list((f) => ({ query: { entityId: f.programmeId } })),
};
