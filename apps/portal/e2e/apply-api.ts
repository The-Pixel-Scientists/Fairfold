// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the apply specs: one funder with an open round,
// an applicant with an organisation, and applications that keep their answers
// as the real API does. The form engine is the real one, so eligibility,
// missing answers and refused saves behave as they will on the server. Answers
// are plain JSON in the shape of the grants contracts
// (modules/grants/src/contracts/applications); the portal checks each one
// against its contract.

import {
  checkEligibility,
  formDefinitionSchema,
  projectAnswers,
  validateAnswers,
  visibleFields,
} from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';
import type { Page } from '@playwright/test';

import { stubFiles } from './apply-files-api.ts';
import type { Attachment, FileStub } from './apply-files-api.ts';
import { applicantSession, problem, standard, stubApi } from './auth-api.ts';
import type { Funder, Handler, SentRequest, SessionOptions } from './auth-api.ts';

export const ROUND_ID = '8a1f3c5e-2b4d-4e6a-9c7b-0d1e2f3a4b5c';
export const APPLICATION_ID = '4b2c6d8e-1f3a-4c5b-8d7e-9a0b1c2d3e4f';
export const SENT_APPLICATION_ID = '6d4e8f0a-3b5c-4e7d-a9f1-2c3d4e5f6a7b';
export const ORGANISATION_ID = '3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55';
const FORM_ID = '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70';

/** Three sections, the first with an eligibility question and a question that depends on an answer, and a budget table. */
export const form = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_about',
      title: 'About your organisation',
      fields: [
        {
          id: 'f_charity',
          type: 'yes_no',
          label: 'Is your organisation a registered charity?',
          required: true,
          eligibility: {
            stopWhen: false,
            explanation: 'This programme is open to registered charities only.',
          },
        },
        { id: 'f_name', type: 'short_text', label: 'Organisation name', required: true },
        { id: 'f_haveweb', type: 'yes_no', label: 'Do you have a website?', required: true },
        {
          id: 'f_web',
          type: 'url',
          label: 'Website address',
          required: true,
          conditions: [{ field: 'f_haveweb', equals: true }],
        },
        { id: 'f_contact', type: 'email', label: 'Contact email address', required: true },
      ],
    },
    {
      id: 's_project',
      title: 'Your project',
      introduction: 'Tell us what you will do, and who it will help.',
      fields: [
        {
          id: 'f_summary',
          type: 'long_text',
          label: 'Project summary',
          hint: 'Say what you will do and who it is for.',
          required: true,
          maxWords: 50,
        },
        {
          id: 'f_people',
          type: 'number',
          label: 'How many people will take part?',
          wholeNumber: true,
        },
      ],
    },
    {
      id: 's_budget',
      title: 'Budget',
      fields: [
        {
          id: 'f_costs',
          type: 'table',
          label: 'Costs of the project',
          hint: 'Add a row for each cost. We add up the costs for you.',
          required: true,
          rowNoun: 'cost',
          columns: [
            { id: 'c_item', type: 'short_text', label: 'Item' },
            { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
          ],
        },
      ],
    },
  ],
});

/**
 * The same form with a documents section: accounts, which are needed and may
 * be up to two files, a safeguarding policy and a note, which are not needed.
 */
export const filesForm = formDefinitionSchema.parse({
  sections: [
    ...form.sections,
    {
      id: 's_documents',
      title: 'Documents',
      fields: [
        {
          id: 'f_accounts',
          type: 'file',
          label: 'Your latest accounts',
          hint: 'Signed by a trustee.',
          required: true,
          allowedTypes: [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ],
          maxFiles: 2,
        },
        {
          id: 'f_policy',
          type: 'file',
          label: 'Your safeguarding policy',
          allowedTypes: ['application/pdf'],
        },
        {
          id: 'f_note',
          type: 'long_text',
          label: 'Anything else we should know about your documents?',
          maxWords: 50,
        },
      ],
    },
  ],
});

/** Answers with nothing missing. */
export const completeAnswers: Answers = {
  f_charity: true,
  f_name: 'Eastmere Community Garden',
  f_haveweb: false,
  f_contact: 'hello@eastmere.example',
  f_summary: 'A weekly lunch for older people in the village hall.',
  f_people: 40,
  f_costs: [{ c_item: 'Hall hire', c_cost: { amountMinor: 288_000, currency: 'GBP' } }],
};

const round = {
  id: ROUND_ID,
  title: 'Spring 2027',
  programme: {
    id: '1c3e5a7b-9d0f-4b2c-8e4a-6f8b0d2c4e61',
    title: 'Community Spaces Fund',
    summary: 'Grants for community groups that bring people together.',
  },
  closesAt: '2026-11-02T17:00',
  timeZone: 'Europe/London',
  awardMinimum: { amountMinor: 500_000, currency: 'GBP' },
  awardMaximum: { amountMinor: 2_500_000, currency: 'GBP' },
};

const ORGANISATION_NAME = 'Eastmere Community Garden';

/** One of the applicant's applications as the API holds it. */
export interface Application {
  id: string;
  status: 'in_progress' | 'submitted' | 'under_review' | 'withdrawn';
  answers: Answers;
  answersVersion: number;
  updatedAt: string;
  submittedAt: string | null;
  withdrawnAt: string | null;
}

/** A draft that has just been started. */
export const draft = (overrides: Partial<Application> = {}): Application => ({
  id: APPLICATION_ID,
  status: 'in_progress',
  answers: {},
  answersVersion: 1,
  updatedAt: '2026-10-20T10:36:00.000Z',
  submittedAt: null,
  withdrawnAt: null,
  ...overrides,
});

/** An application that has been sent. */
export const sent = (overrides: Partial<Application> = {}): Application =>
  draft({
    id: SENT_APPLICATION_ID,
    status: 'submitted',
    answers: completeAnswers,
    submittedAt: '2026-10-21T12:00:00.000Z',
    ...overrides,
  });

const summaryOf = (application: Application, organisation: { id: string; name: string }) => ({
  id: application.id,
  round: {
    id: ROUND_ID,
    title: round.title,
    programmeTitle: round.programme.title,
    closesAt: round.closesAt,
    timeZone: round.timeZone,
  },
  organisation,
  status: application.status,
  updatedAt: application.updatedAt,
  submittedAt: application.submittedAt,
  outcome: null,
});

/** The answers as the API builds them: the saved ones, with the ids of the files attached to each shown file question. */
function answersWith(
  definition: FormDefinition,
  answers: Answers,
  files: readonly Attachment[],
): Answers {
  const shown = new Set(visibleFields(definition, answers).map(({ id }) => id));
  const merged = { ...answers };
  for (const { id } of definition.sections.flatMap(({ fields }) => fields)) {
    const ids = files.filter(({ fieldId }) => fieldId === id).map((file) => file.id);
    if (shown.has(id) && ids.length > 0) merged[id] = ids;
  }
  return merged;
}

const ok = (body: unknown) => ({ status: 200, body });

export interface ApplyOptions {
  /** The applications the applicant already has. */
  applications?: Application[];
  /** The files attached to each application, by its id. */
  files?: Record<string, Attachment[]>;
  /** The round's form, in place of the one with no file question. */
  form?: FormDefinition;
  /** Whether a round is open. */
  open?: boolean;
  /** Whether the applicant has added an organisation. */
  organisations?: boolean;
  /** The name of the applicant's organisation. */
  organisationName?: string;
  /** Handlers that add to, or replace, the API's answers. */
  more?: Record<string, Handler>;
  funder?: Funder;
  session?: SessionOptions;
}

export interface ApplyStub extends FileStub {
  /** The applicant's applications as the API holds them. A spec may change them between steps. */
  applications: Application[];
  /** The files attached to each application, by its id. */
  files: Record<string, Attachment[]>;
  /** Every request sent so far. */
  sent: SentRequest[];
  /** Makes the next `count` saves fail, as if the service were busy. */
  failSaves: (count: number) => void;
}

/**
 * A signed-in applicant with an open round, whose applications keep their
 * answers. Starting an application adds one; saving, checking, submitting and
 * withdrawing change it.
 */
export async function stubApply(page: Page, options: ApplyOptions = {}): Promise<ApplyStub> {
  const {
    form: definition = form,
    open = true,
    organisations = true,
    organisationName = ORGANISATION_NAME,
    more = {},
    funder = standard,
    session = {},
  } = options;
  const organisation = { id: ORGANISATION_ID, name: organisationName };
  const applications = structuredClone(options.applications ?? []);
  const files = structuredClone(options.files ?? {});
  let failing = 0;
  const find = (id: string) => applications.find((application) => application.id === id);
  const missing = () => problem(404, 'Not found.');
  const answersOf = (application: Application) =>
    answersWith(definition, application.answers, files[application.id] ?? []);
  const fullOf = (application: Application) => ({
    ...summaryOf(application, organisation),
    form: { id: FORM_ID, definition },
    answers: answersOf(application),
    answersVersion: application.answersVersion,
    eligibility: checkEligibility(definition, answersOf(application)),
    withdrawnAt: application.withdrawnAt,
  });

  const handlers: Record<string, Handler> = {
    'GET /auth/session': { status: 200, body: applicantSession(session) },
    'POST /auth/sign-out': { status: 204 },
    'GET /portal/rounds': () => ok({ rounds: open ? [round] : [] }),
    [`GET /portal/rounds/${ROUND_ID}`]: () =>
      open
        ? ok({
            ...round,
            programme: {
              ...round.programme,
              description:
                'We pay for the everyday costs of a project.\n\nWe fund halls, equipment and training.',
            },
            form: { id: FORM_ID, definition },
          })
        : missing(),
    'GET /portal/organisations': () =>
      ok({
        organisations: organisations ? [{ ...organisation, legalForm: 'registered_charity' }] : [],
      }),
    [`POST /portal/rounds/${ROUND_ID}/applications`]: () => {
      if (applications.some(({ status }) => status !== 'withdrawn')) {
        return problem(409, 'This organisation has already started an application for this round.');
      }
      const started = draft();
      applications.push(started);
      return { status: 201, body: fullOf(started) };
    },
    'GET /portal/applications': () =>
      ok({ applications: applications.map((application) => summaryOf(application, organisation)) }),
  };

  for (const id of [APPLICATION_ID, SENT_APPLICATION_ID]) {
    const path = `/portal/applications/${id}`;
    handlers[`GET ${path}`] = () => {
      const application = find(id);
      return application ? ok(fullOf(application)) : missing();
    };
    handlers[`GET ${path}/files`] = () => ok({ attachments: files[id] ?? [] });
    handlers[`PUT ${path}/answers`] = (body) => {
      const application = find(id);
      if (!application) return missing();
      if (failing > 0) {
        failing -= 1;
        return problem(503, 'The service is busy. Try again in a minute.');
      }
      const { basedOn, answers } = body as { basedOn: number; answers: Answers };
      if (basedOn !== application.answersVersion) {
        return problem(409, 'These answers have changed since you opened them.');
      }
      // A file is attached, never saved as an answer.
      const attached = Object.keys(answers).filter((key) =>
        definition.sections.some(({ fields }) =>
          fields.some((field) => field.id === key && field.type === 'file'),
        ),
      );
      if (attached.length > 0) {
        return problem(
          400,
          'Attach files to their questions.',
          attached.map((field) => ({ field, message: 'Upload a file for this question.' })),
        );
      }
      const problems = validateAnswers(definition, answers, 'draft');
      if (problems.length > 0) return problem(400, 'Some answers are not valid.', problems);
      application.answers = projectAnswers(definition, answers, 'applicant');
      application.answersVersion += 1;
      application.updatedAt = new Date().toISOString();
      return ok({ answersVersion: application.answersVersion, updatedAt: application.updatedAt });
    };
    handlers[`POST ${path}/eligibility-check`] = () => {
      const application = find(id);
      return application ? ok(checkEligibility(definition, answersOf(application))) : missing();
    };
    handlers[`POST ${path}/submit`] = (body) => {
      const application = find(id);
      if (!application) return missing();
      if ((body as { basedOn: number }).basedOn !== application.answersVersion) {
        return problem(409, 'These answers have changed since you opened them.');
      }
      const problems = validateAnswers(definition, answersOf(application), 'submit');
      if (
        problems.length > 0 ||
        checkEligibility(definition, answersOf(application)).status !== 'eligible'
      ) {
        return problem(422, 'Some answers are missing.', problems);
      }
      application.status = 'submitted';
      application.submittedAt = new Date().toISOString();
      return ok(fullOf(application));
    };
    handlers[`POST ${path}/withdraw`] = () => {
      const application = find(id);
      if (!application) return missing();
      application.status = 'withdrawn';
      application.withdrawnAt = new Date().toISOString();
      return ok(fullOf(application));
    };
  }

  const requests = await stubApi(page, { ...handlers, ...more }, funder);
  const uploads = await stubFiles(page, files, definition);
  return {
    ...uploads,
    applications,
    files,
    sent: requests,
    failSaves: (count) => {
      failing = count;
    },
  };
}
