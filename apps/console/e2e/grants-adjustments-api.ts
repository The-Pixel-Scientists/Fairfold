// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the adjustment, assisted submission and
// equality monitoring specs: a programme manager of a funder with one round,
// one submission and one organisation with the alternative route. It keeps
// what the specs change (adjustments, the draft's answers, whether it was
// submitted, the round's monitoring form), and asks for step-up before it
// starts or submits an application, as the real API does. Answers are plain
// JSON in the shape of the contracts in modules/grants/src/contracts.

import { monitoringTemplate } from '@pixel-scientists/grants/contracts';
import type { Page } from '@playwright/test';

import { consoleSession, problem } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';
import { configured, ids, round, stubProgrammes } from './programme-api.ts';
import { crowd, detail } from './submissions-api.ts';

const ok = (body: unknown): Reply => ({ status: 200, body });
const created = (body: unknown): Reply => ({ status: 201, body });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

/** The submission the specs open: it is also the application the member fills in. */
export const submission =
  crowd(1)[0] ??
  (() => {
    throw new Error('No submission.');
  })();

export const organisation = { id: submission.organisation.id, name: submission.organisation.name };
export const contact = { personId: uuid(4000), givenName: 'Sam', familyName: 'Patel' };
const member = { membershipId: uuid(11), name: 'Ada Reed' };

const permissions = [
  'party.records.read',
  'grants.programmes.manage',
  'grants.applications.read',
  'grants.applications.triage',
  'grants.reviews.assign',
  'grants.decisions.record',
  'grants.decisions.release',
  'grants.adjustments.manage',
  'grants.applications.assist',
];

const questions = {
  sections: [
    {
      id: 's_org',
      title: 'About your organisation',
      conditions: [],
      fields: [
        {
          id: 'f_charity',
          type: 'yes_no',
          label: 'Is your organisation a registered charity?',
          required: true,
          identity: false,
          audiences: ['applicant', 'staff', 'reviewer'],
          conditions: [],
        },
        {
          id: 'f_story',
          type: 'long_text',
          label: 'What will you do with the money?',
          required: true,
          identity: false,
          audiences: ['applicant', 'staff', 'reviewer'],
          conditions: [],
        },
      ],
    },
  ],
};

export const monitoringVersionId = uuid(5000);
export const monitoringDraftId = uuid(5001);

export interface GrantsStub {
  adjustments: Record<string, unknown>[];
  /** The draft's answers and the version the next save is based on. */
  draft: { answers: Record<string, unknown>; version: number };
  submitted: boolean;
  monitoringFormVersionId: string | null;
  /** The draft started from the monitoring template, and what was saved into it. */
  monitoringDraft: { status: 'draft' | 'published'; definition: unknown } | null;
  sent: SentRequest[];
}

export const grantAdjustmentFor = (n: number, change: Record<string, unknown> = {}) => ({
  id: uuid(7000 + n),
  roundId: ids.round,
  organisation,
  applicationId: null,
  kind: 'deadline_extension',
  closesAt: '2026-11-09T17:00',
  timeZone: 'Europe/London',
  reasonCode: 'technical_problem',
  grantedBy: member,
  grantedAt: '2026-11-01T10:30:00.000Z',
  revoked: null,
  ...change,
});

export interface GrantsOptions {
  /** Start with these adjustments. */
  adjustments?: Record<string, unknown>[];
  /** Answers to hold in the draft the member is filling in. */
  answers?: Record<string, unknown>;
}

export async function stubGrants(page: Page, options: GrantsOptions = {}): Promise<GrantsStub> {
  const state: Omit<GrantsStub, 'sent'> = {
    adjustments: options.adjustments ?? [
      grantAdjustmentFor(1),
      grantAdjustmentFor(2, { kind: 'alternative_route', closesAt: null }),
    ],
    draft: { answers: options.answers ?? {}, version: 1 },
    submitted: false,
    monitoringFormVersionId: null,
    monitoringDraft: null,
  };
  let steppedUp = false;
  const stepUp = (): Reply | null => {
    if (steppedUp) {
      steppedUp = false;
      return null;
    }
    return problem(403, STEP_UP_NEEDED);
  };

  const submissionPath = `/console/submissions/${submission.id}`;
  const draftVersion = () => ({
    id: monitoringDraftId,
    roundId: ids.round,
    version: 3,
    status: state.monitoringDraft?.status ?? 'draft',
    definition: state.monitoringDraft?.definition ?? null,
    updatedAt: '2026-11-03T09:00:00.000Z',
    publishedAt: state.monitoringDraft?.status === 'published' ? '2026-11-03T09:10:00.000Z' : null,
    publishedBy: state.monitoringDraft?.status === 'published' ? member : null,
  });
  const draftPath = `/console/assisted-applications/${submission.id}`;
  const roundPath = `/console/rounds/${ids.round}`;
  const closesAt = () =>
    state.adjustments
      .filter((item) => item['revoked'] === null && item['kind'] === 'deadline_extension')
      .map((item) => String(item['closesAt']))
      .sort()
      .at(-1) ?? round.closesAt;

  const application = () => ({
    id: submission.id,
    organisation,
    contact: { personId: contact.personId, name: 'Sam Patel' },
    updatedAt: '2026-11-03T09:00:00.000Z',
    round: { id: ids.round, title: round.title },
    closesAt: closesAt(),
    timeZone: round.timeZone,
    form: { id: uuid(3000), definition: questions },
    answers: state.draft.answers,
    answersVersion: state.draft.version,
    eligibility: { status: 'incomplete' },
  });

  const submitted = () => ({
    ...detail(submission),
    form: { id: uuid(3000), version: 2, definition: questions },
    answers: state.draft.answers,
    ...(state.submitted ? { submissionRoute: 'assisted', submittedBy: member } : {}),
  });

  const handlers: Record<string, Handler> = {
    [`GET ${submissionPath}`]: () => ok(submitted()),
    [`GET ${submissionPath}/files`]: ok({ attachments: [] }),
    [`GET ${submissionPath}/assignments`]: ok({ assignments: [] }),
    'GET /console/submissions': ok({
      submissions: [submission],
      total: 1,
      nextCursor: null,
    }),
    [`GET ${submissionPath}/adjustments`]: () =>
      ok({ adjustments: state.adjustments, closesAt: closesAt(), timeZone: round.timeZone }),
    [`GET ${roundPath}/adjustments`]: () => ok({ adjustments: state.adjustments }),
    [`POST ${roundPath}/adjustments`]: (body) => {
      const input = body as Record<string, unknown>;
      const next = grantAdjustmentFor(state.adjustments.length + 1, {
        kind: input['kind'],
        closesAt: input['closesAt'] ?? null,
        reasonCode: input['reasonCode'],
        applicationId: input['applicationId'] ?? null,
      });
      state.adjustments = [next, ...state.adjustments];
      return created(next);
    },
    [`POST /console/adjustments/${uuid(7001)}/revoke`]: (body) => {
      state.adjustments = state.adjustments.map((item) =>
        item['id'] === uuid(7001)
          ? {
              ...item,
              revoked: {
                by: member,
                at: '2026-11-04T09:00:00.000Z',
                reasonCode: (body as { reasonCode: string }).reasonCode,
              },
            }
          : item,
      );
      return ok(state.adjustments.find((item) => item['id'] === uuid(7001)));
    },
    'GET /console/organisations': ok({
      organisations: [{ ...organisation, legalForm: 'other', identifiers: [] }],
      nextCursor: null,
    }),
    [`GET /console/organisations/${organisation.id}`]: ok({
      ...organisation,
      legalForm: 'other',
      identifiers: [],
      registeredAddress: {
        line1: '1 High Street',
        line2: null,
        town: 'Leeds',
        postcode: 'LS1 1AA',
        countryCode: 'GB',
      },
      website: null,
      contacts: [{ ...contact, email: 'sam@example.org' }],
    }),
    [`GET ${roundPath}/assisted-applications`]: () =>
      ok({
        applications: [
          {
            id: submission.id,
            organisation,
            contact: { personId: contact.personId, name: 'Sam Patel' },
            updatedAt: '2026-11-03T09:00:00.000Z',
          },
        ],
      }),
    [`POST ${roundPath}/assisted-applications`]: () => stepUp() ?? created(application()),
    [`GET ${draftPath}`]: () => ok(application()),
    [`PUT ${draftPath}/answers`]: (body) => {
      const input = body as { answers: Record<string, unknown> };
      state.draft = { answers: input.answers, version: state.draft.version + 1 };
      return ok({ answersVersion: state.draft.version, updatedAt: '2026-11-03T09:05:00.000Z' });
    },
    [`POST ${draftPath}/eligibility-check`]: () =>
      ok({ status: state.draft.answers['f_charity'] === undefined ? 'incomplete' : 'eligible' }),
    [`POST ${draftPath}/submit`]: () => {
      const refused = stepUp();
      if (refused) return refused;
      state.submitted = true;
      return ok(submitted());
    },
    'POST /auth/step-up': () => {
      steppedUp = true;
      return ok(consoleSession({ permissions }));
    },
    [`GET ${roundPath}/monitoring-form`]: () =>
      ok({ formVersionId: state.monitoringFormVersionId }),
    [`PUT ${roundPath}/monitoring-form`]: (body) => {
      state.monitoringFormVersionId = (body as { formVersionId: string | null }).formVersionId;
      return ok({ formVersionId: state.monitoringFormVersionId });
    },
    [`GET ${roundPath}/form-versions`]: () =>
      ok({
        versions: [
          ...(state.monitoringDraft === null ? [] : [{ ...draftVersion(), definition: undefined }]),
          {
            id: monitoringVersionId,
            version: 2,
            status: 'published',
            updatedAt: '2026-10-14T13:15:00.000Z',
            publishedAt: '2026-10-14T13:15:00.000Z',
            publishedBy: member,
          },
        ],
      }),
    [`POST ${roundPath}/form-versions`]: () => {
      state.monitoringDraft = { status: 'draft', definition: null };
      return created(draftVersion());
    },
    [`GET /console/form-versions/${monitoringDraftId}`]: () => ok(draftVersion()),
    [`PUT /console/form-versions/${monitoringDraftId}/definition`]: (body) => {
      state.monitoringDraft = {
        status: 'draft',
        definition: (body as { definition: unknown }).definition,
      };
      return ok(draftVersion());
    },
    [`POST /console/form-versions/${monitoringDraftId}/publish`]: () => {
      state.monitoringDraft = {
        status: 'published',
        definition: state.monitoringDraft?.definition,
      };
      return ok(draftVersion());
    },
    [`GET /console/form-versions/${monitoringVersionId}`]: ok({
      id: monitoringVersionId,
      roundId: ids.round,
      version: 2,
      status: 'published',
      updatedAt: '2026-10-14T13:15:00.000Z',
      publishedAt: '2026-10-14T13:15:00.000Z',
      publishedBy: member,
      definition: monitoringTemplate(),
    }),
  };

  const { sent } = await stubProgrammes(page, configured(), handlers, permissions);
  return Object.assign(state, { sent });
}
