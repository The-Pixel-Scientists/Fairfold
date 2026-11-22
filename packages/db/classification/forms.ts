// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the forms schema (migration 0079, ADR 0016, ADR
// 0036). Ids, statuses, routes, settings, codes, times and the proof hash
// are internal; titles, descriptions, confirmation messages and definitions
// are staff-written configuration that must not name a person. A response's
// answers are classified field by field from the version it pinned (ADR
// 0027); the column itself is special category, the most any answer can be.
// The token, idempotency key and request hashes are personal, as
// pseudonymous identifiers of an anonymous respondent (ADR 0036). Links to
// people and memberships are internal ids, as elsewhere in the map.
//
// Forms and versions are kept while the tenant is a customer. A submitted
// response, and its token, is kept until its retain_until, which the
// database sets from the form's retention months (12 at most for a form
// anyone can answer) and no app role changes; a token ends with it. The
// existing rule kinds cannot say "until this row's time", so these are a
// day past it, and retention takes them once a later migration gives
// app.apply_retention() its forms targets. A draft is the respondent's own
// unsaved work and has no retain_until until it is submitted.
//
// A signed-in response is about its respondent's person; its token, through
// the response. Forms and versions are about no one. An anonymous response
// has no party subject: it is found by its id, or by the reference its
// respondent quotes, and erased by field class as ADR 0027 sets out.
// forms.erase_subject clears a person's answers above internal.

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
const response: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 1, from: 'retain_until' },
};
const responseHash: FieldClassification = { ...response, sensitivity: 'personal' };
const token: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 1, from: 'expires_at' },
};

const key = { tenant_id: internal, id: internal } as const;
const actors = { created_by: internal, updated_by: internal } as const;
const times = { created_at: internal, updated_at: internal } as const;

export const forms = {
  'forms.form': {
    ...key,
    title: internal,
    description: internal,
    respondents: internal,
    opens_at: internal,
    closes_at: internal,
    retention_months: internal,
    confirmation_message: internal,
    archived_at: internal,
    ...times,
    ...actors,
  },
  'forms.form_version': {
    ...key,
    form_id: internal,
    version: internal,
    status: internal,
    respondents: internal,
    definition: internal,
    published_at: internal,
    published_by: internal,
    config_version_id: internal,
    ...times,
    ...actors,
  },
  'forms.response': {
    tenant_id: response,
    id: response,
    form_id: response,
    form_version_id: response,
    route: response,
    respondent_person_id: response,
    status: response,
    answers: {
      sensitivity: 'special_category',
      retention: response.retention,
      perField: {
        versionColumn: 'form_version_id',
        definition: { table: 'forms.form_version', column: 'definition' },
      },
    },
    submitted_at: response,
    retain_until: response,
    spam_reason: response,
    spam_marked_by: response,
    spam_marked_at: response,
    idempotency_key_hash: responseHash,
    request_hash: responseHash,
    proof_hash: response,
    created_at: response,
    created_by: response,
    updated_at: response,
    updated_by: response,
  },
  'forms.respondent_token': {
    tenant_id: token,
    id: token,
    response_id: token,
    token_hash: { ...token, sensitivity: 'personal' },
    expires_at: token,
    revoked_at: token,
    revoked_by: token,
    created_at: token,
    updated_at: token,
  },
} as const satisfies ClassificationRegistry;

export const formsSubjects: SubjectPathRegistry = {
  'forms.response': { kind: 'party', column: 'respondent_person_id' },
  'forms.respondent_token': { kind: 'join', column: 'response_id', table: 'forms.response' },
};

const stored = ['hosting', 'backup'] as const;

const setUp: ProcessingEntry = {
  purpose: 'form_responses',
  legalBasis: 'legitimate_interests',
  processors: stored,
  dataSubjects: [],
  dataCategories: [],
};

export const formsProcessing: ProcessingRegistry<typeof forms> = {
  'forms.form': setUp,
  'forms.form_version': setUp,
  // Answers are classified per field with a special category ceiling, given
  // under explicit consent, as grants' are. Signed-in respondents answer in
  // the portal; anyone else is a visitor.
  'forms.response': {
    ...setUp,
    article9Condition: 'explicit_consent',
    dataSubjects: ['applicant', 'visitor'],
    dataCategories: ['identity', 'contact', 'online_identifiers', 'other'],
  },
  'forms.respondent_token': {
    ...setUp,
    dataSubjects: ['visitor'],
    dataCategories: ['online_identifiers'],
  },
};
