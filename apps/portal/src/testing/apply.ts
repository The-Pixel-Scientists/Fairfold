// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: a funder's open round and an applicant's application, built
// through the contracts so a fixture cannot drift from them, and a stand-in for
// the API that keeps the application, so a test can save, check and submit it.
// Not part of the app.

import {
  checkEligibility,
  formDefinitionSchema,
  validateAnswers,
} from '@pixel-scientists/domain/forms';
import type { Answers } from '@pixel-scientists/domain/forms';
import {
  applicationListSchema,
  applicationSchema,
  applicationSummarySchema,
  attachmentListSchema,
  attachmentViewSchema,
  openRoundDetailSchema,
  openRoundListSchema,
} from '@pixel-scientists/grants/contracts';
import type {
  Application,
  ApplicationSummary,
  AttachmentView,
  SaveAnswersInput,
} from '@pixel-scientists/grants/contracts';

import { problem } from './api.ts';
import type { Reply } from './api.ts';
import { ok } from './party.ts';

export const ROUND_ID = '8a1f3c5e-2b4d-4e6a-9c7b-0d1e2f3a4b5c';
export const APPLICATION_ID = '4b2c6d8e-1f3a-4c5b-8d7e-9a0b1c2d3e4f';
export const OTHER_APPLICATION_ID = '6d4e8f0a-3b5c-4e7d-a9f1-2c3d4e5f6a7b';
const FORM_ID = '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70';

/** Three sections, the first with an eligibility question and a question that depends on an answer, and a budget table. */
export const definition = formDefinitionSchema.parse({
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
          hint: 'Add a row for each cost.',
          required: true,
          rowNoun: 'cost',
          columns: [
            { id: 'c_item', type: 'short_text', label: 'Item' },
            { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
          ],
        },
        {
          id: 'f_accounts',
          type: 'file',
          label: 'Your latest accounts',
          hint: 'A PDF or Word document.',
          required: true,
        },
      ],
    },
  ],
});

export const round = {
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
} as const;

export const openRoundList = (...rounds: (typeof round)[]): Reply =>
  ok(openRoundListSchema.parse({ rounds: rounds.length === 0 ? [] : rounds }));

export const roundDetail = (): Reply =>
  ok(
    openRoundDetailSchema.parse({
      ...round,
      programme: {
        ...round.programme,
        description:
          'We pay for the everyday costs of a project.\n\nWe fund halls, equipment and training.',
      },
      form: { id: FORM_ID, definition },
    }),
  );

/** What a test changes about an application. Answers are plain: the contract checks them. */
export type Changes = Omit<Partial<Application>, 'answers'> & { answers?: Answers };

export function application(overrides: Changes = {}): Application {
  return applicationSchema.parse({
    id: APPLICATION_ID,
    round: {
      id: ROUND_ID,
      title: round.title,
      programmeTitle: round.programme.title,
      closesAt: round.closesAt,
      timeZone: round.timeZone,
    },
    organisation: { id: '3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55', name: 'Eastmere Community Garden' },
    status: 'in_progress',
    updatedAt: '2026-10-20T10:36:00.000Z',
    submittedAt: null,
    outcome: null,
    form: { id: FORM_ID, definition },
    answers: {},
    answersVersion: 1,
    eligibility: { status: 'incomplete' },
    withdrawnAt: null,
    ...overrides,
  });
}

/** Answers that are all well, apart from the accounts file, which is a file question. */
export const completeAnswers: Answers = {
  f_charity: true,
  f_name: 'Eastmere Community Garden',
  f_haveweb: false,
  f_contact: 'hello@eastmere.example',
  f_summary: 'A weekly lunch for older people.',
  f_people: 40,
  f_costs: [{ c_item: 'Hall hire', c_cost: { amountMinor: 288_000, currency: 'GBP' } }],
};

export const FILE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** A file attached to the accounts question, checked against the contract. */
export function attachment(overrides: Partial<AttachmentView> = {}): AttachmentView {
  return attachmentViewSchema.parse({
    id: FILE_ID,
    fieldId: 'f_accounts',
    name: 'accounts-2026.pdf',
    type: 'application/pdf',
    bytes: 2_202_010,
    uploadedAt: '2026-10-20T10:30:00.000Z',
    ...overrides,
  });
}

/** One of the applicant's applications, as the list shows it. */
export function summary(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return applicationSummarySchema.parse({ ...application(), ...overrides });
}

export const applicationList = (...applications: ApplicationSummary[]): Reply =>
  ok(applicationListSchema.parse({ applications }));

export interface ApplicationServer {
  /** The application as the API holds it. */
  current: Application;
  /** The files attached to it, as the list route answers them. */
  files: AttachmentView[];
  /** Changes it, as another window or the staff would. */
  update: (changes: Changes) => void;
  /** The body of each save it accepted. */
  saved: SaveAnswersInput[];
  /** The API's answers to the application's own routes, to give `stubApi`. */
  handlers: Record<string, (body: unknown) => Reply>;
}

/**
 * The API for one application: reading, saving answers (refusing a save based
 * on old answers, as the real one does), checking eligibility, submitting and
 * withdrawing, all through the form engine the server uses.
 */
export function applicationServer(
  start: Application = application(),
  files: AttachmentView[] = [],
): ApplicationServer {
  const server: ApplicationServer = {
    current: start,
    files,
    update: (changes) => {
      server.current = application({ ...server.current, ...changes });
    },
    saved: [],
    handlers: {},
  };
  const base = `/portal/applications/${start.id}`;
  const change = server.update;

  server.handlers = {
    [`GET ${base}`]: () => ok(server.current),
    [`GET ${base}/files`]: () => ok(attachmentListSchema.parse({ attachments: server.files })),
    ...Object.fromEntries(
      files.map(({ id }) => [
        `DELETE ${base}/files/${id}`,
        () => {
          server.files = server.files.filter((file) => file.id !== id);
          return { status: 204 };
        },
      ]),
    ),
    [`PUT ${base}/answers`]: (body) => {
      const input = body as SaveAnswersInput;
      if (input.basedOn !== server.current.answersVersion) {
        return problem(409, 'These answers have changed since you opened them.');
      }
      server.saved.push(input);
      const updatedAt = new Date().toISOString();
      change({ answers: input.answers, answersVersion: input.basedOn + 1, updatedAt });
      return ok({ answersVersion: input.basedOn + 1, updatedAt });
    },
    [`POST ${base}/eligibility-check`]: () =>
      ok(checkEligibility(definition, server.current.answers)),
    [`POST ${base}/submit`]: (body) => {
      const { basedOn } = body as { basedOn: number };
      if (basedOn !== server.current.answersVersion) {
        return problem(409, 'These answers have changed since you opened them.');
      }
      // As the server checks it: the saved answers, with the ids of the files attached.
      const attached = server.files.map(({ id }) => id);
      const answers = {
        ...server.current.answers,
        ...(attached.length > 0 && { f_accounts: attached }),
      };
      const problems = validateAnswers(definition, answers, 'submit');
      if (
        problems.length > 0 ||
        checkEligibility(definition, server.current.answers).status !== 'eligible'
      ) {
        return problem(422, 'Some answers are missing.', problems);
      }
      change({ status: 'submitted', submittedAt: '2026-10-21T14:14:00.000Z' });
      return ok(server.current);
    },
    [`POST ${base}/withdraw`]: () => {
      change({ status: 'withdrawn', withdrawnAt: '2026-10-22T09:00:00.000Z' });
      return ok(server.current);
    },
  };
  return server;
}
