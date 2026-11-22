// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party each privacy audit event is about (ADR 0027). A rights request
// and its clock events and tasks are about the person who asked; the platform
// finds them in the request's transaction, so a record in another tenant
// finds nothing. A breach, an assessment and a DPIA have no column that
// names a person, so their events have none.

import { partyErasureTarget, type SubjectRule } from '@pixel-scientists/party/server';

import type { PrivacyAuditAction } from '../contracts/index.ts';
import { privacyDb } from './context.ts';

/** The entity is a rights request, or an event on one. */
const request: SubjectRule = {
  subject: async (tx, { entityId }) =>
    (
      await privacyDb(tx)
        .selectFrom('privacy.rights_request')
        .select('subject_person_id')
        .where('id', '=', entityId)
        .executeTakeFirst()
    )?.subject_person_id ?? null,
};

/** The entity is a task, which is about its request's person. */
const task: SubjectRule = {
  subject: async (tx, { entityId }) =>
    (
      await privacyDb(tx)
        .selectFrom('privacy.request_task as t')
        .innerJoin('privacy.rights_request as r', 'r.id', 't.request_id')
        .select('r.subject_person_id')
        .where('t.id', '=', entityId)
        .executeTakeFirst()
    )?.subject_person_id ?? null,
};

/** The entity is the person whose consent history was read, if the tenant has them. */
const person: SubjectRule = {
  subject: async (tx, { entityId }) =>
    (await partyErasureTarget(tx, entityId)) === null ? null : entityId,
};

const breach: SubjectRule = {
  none: 'A breach and its assessments name no person; their text may, but no column links one.',
};
const dpia: SubjectRule = { none: 'A DPIA covers processing activities, not a person.' };
const register: SubjectRule = { none: 'The tenant records its own processing, not a person.' };

export const privacySubjectRules: Readonly<Record<PrivacyAuditAction, SubjectRule>> = {
  'privacy.rights_request.created': request,
  'privacy.rights_request.updated': request,
  'privacy.rights_request.paused': request,
  'privacy.rights_request.resumed': request,
  'privacy.rights_request.extended': request,
  'privacy.rights_request.closed': request,
  'privacy.rights_request.viewed': request,
  'privacy.rights_request.export_started': request,
  'privacy.rights_request.export_viewed': request,
  'privacy.rights_request.erasure_started': request,
  'privacy.request_task.created': task,
  'privacy.request_task.updated': task,
  'privacy.request_task.completed': task,
  'privacy.breach.recorded': breach,
  'privacy.breach.updated': breach,
  'privacy.breach.assessed': breach,
  'privacy.breach.ico_notified': breach,
  'privacy.breach.subjects_notified': breach,
  'privacy.breach.viewed': breach,
  'privacy.dpia.created': dpia,
  'privacy.dpia.updated': dpia,
  'privacy.dpia.signed_off': dpia,
  'privacy.dpia.viewed': dpia,
  'privacy.processing_activity.changed': register,
  'privacy.processor.changed': register,
  'privacy.consent_history.viewed': person,
};
