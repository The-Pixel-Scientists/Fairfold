// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The people the isolation walk calls as, signed in through the API: the
// first funder's own staff and applicants, and the second funder's, with the
// ids of the first funder's records that the journey made.

import { signInApplicant, signInStaff, stepUp, type Api } from '../support/api.ts';
import { createApplicantAccount, addressFor } from '../support/applicants.ts';
import { groups } from '../support/applications.ts';
import { need, person, readState } from '../support/state.ts';
import type { Fixture } from './cases.ts';

/** The staff of a funder, and an applicant, each in an Api session of their own. */
export type Side = {
  admin: Api;
  manager: Api;
  reviewer: Api;
  applicant: Api;
};

export interface World {
  fixture: Fixture;
  /** What must never appear in an answer to someone outside the first funder. */
  markers: string[];
  /** The first funder, with a second reviewer and a second applicant beside the first of each. */
  a: Side & { reviewer2: Api; applicant2: Api };
  b: Side;
}

interface Team {
  members: { id: string; email: string }[];
  invitations: { id: string; email: string }[];
}

/** Signs in each of the first funder's staff and applicants and finds the ids the cases name. */
export async function openWorld(): Promise<World> {
  // The colleague step 14 invited holds the administrator role alone; the first administrator now holds two.
  const admin = await signInStaff('northfield', 'colleague');
  await stepUp(admin, 'colleague');
  const manager = await signInStaff('northfield', 'manager');
  const reviewer = await signInStaff('northfield', 'reviewer1');
  const reviewer2 = await signInStaff('northfield', 'reviewer2');
  const applicant = await signInApplicant('northfield', 'applicant1');
  const applicant2 = await signInApplicant('northfield', 'applicant2');

  const pending = addressFor('pending-invitation');
  await admin.ok('POST', '/console/team/invitations', {
    json: { email: pending, roles: ['reviewer'] },
  });
  const team = await admin.ok<Team>('GET', '/console/team');
  const organisationId = need('applicant1OrganisationId');
  const organisation = await manager.ok<{ contacts: { personId: string }[] }>(
    'GET',
    `/console/organisations/${organisationId}`,
  );
  const assignmentId = readState().lists['reviewer1AssignmentIds']?.[0] ?? '';
  const review = await reviewer.ok<{ criteria: { id: string }[] }>(
    'GET',
    `/console/reviews/${assignmentId}`,
  );

  const fixture: Fixture = {
    programmeId: need('programmeId'),
    roundId: need('roundId'),
    formVersionId: need('formVersionId'),
    intakeStageId: need('intakeStageId'),
    reviewStageId: need('reviewStageId'),
    applicationId: need('application1Id'),
    fileId: need('accountsFileId'),
    fieldId: need('accountsFieldId'),
    organisationId,
    personId: organisation.contacts[0]?.personId ?? '',
    reviewerMembershipId:
      team.members.find(({ email }) => email === person('reviewer1').email)?.id ?? '',
    assignmentId,
    criterionId: review.criteria[0]?.id ?? '',
    invitationId: team.invitations.find(({ email }) => email === pending)?.id ?? '',
  };
  for (const [name, id] of Object.entries(fixture)) {
    const shape = name === 'fieldId' ? /^f_[a-z0-9]+$/ : /^[0-9a-f-]{36}$/;
    if (!shape.test(id)) throw new Error(`The fixture has no ${name}.`);
  }

  const eastAdmin = await signInStaff('eastmoor', 'eastAdmin');
  await stepUp(eastAdmin, 'eastAdmin');
  const eastManager = await signInStaff('eastmoor', 'eastManager');
  await stepUp(eastManager, 'eastManager');
  const eastReviewer = await signInStaff('eastmoor', 'eastReviewer1');
  const eastApplicant = await createApplicantAccount('eastApplicant', 'eastmoor');

  const state = readState();
  const markers = [
    ...Object.values(fixture),
    'Northfield Community Trust',
    'Community Spaces Fund',
    'Eastmere',
    'accounts-2026',
    ...groups.map(({ organisation: name }) => name),
    ...Object.entries(state.people)
      .filter(([name]) => !name.startsWith('east'))
      .map(([, { email }]) => email),
  ];

  return {
    fixture,
    markers,
    a: { admin, manager, reviewer, reviewer2, applicant, applicant2 },
    b: { admin: eastAdmin, manager: eastManager, reviewer: eastReviewer, applicant: eastApplicant },
  };
}

export async function closeWorld(world: World | undefined): Promise<void> {
  if (world === undefined) return;
  const sessions = [...Object.values(world.a), ...Object.values(world.b)];
  await Promise.all(sessions.map((session) => session.dispose()));
}
