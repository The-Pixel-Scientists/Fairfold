// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the forms routes in the browser, for specs that run without
// the stack. Answers are plain JSON in the shape of the forms contracts
// (modules/forms/src/contracts). The pages check every answer against its
// contract, so an answer that drifts shows up as a failing spec. Synthetic
// data only.

import type { Page } from '@playwright/test';

import { applicantSession, stubApi } from './auth-api.ts';
import type { Funder, Handler, Reply, SentRequest } from './auth-api.ts';

export const FORM_ID = '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70';
export const VERSION_ID = '7c1d3e5f-9a2b-4c4d-8e6f-0a1b2c3d4e5f';
export const RESPONSE_ID = '5e7f9a1b-3c5d-4e7f-8a9b-0c1d2e3f4a5b';

export const definition = {
  sections: [
    {
      id: 's_you',
      title: 'About you',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Your name', required: true },
        { id: 'f_town', type: 'short_text', label: 'Your town' },
      ],
    },
    {
      id: 's_more',
      title: 'Anything else',
      fields: [{ id: 'f_note', type: 'long_text', label: 'Your comment' }],
    },
  ],
};

export const SUBMITTED = 'Your answers have been sent';

const PUBLIC = `/public/tenants/northfield/forms/${FORM_ID}`;
const PORTAL = `/portal/forms/${FORM_ID}`;

export const publicForm = {
  formId: FORM_ID,
  formVersionId: VERSION_ID,
  title: 'Funder A feedback',
  description: 'Tell Funder A how we did.',
  definition,
  noProofFallback: true,
};

/** A challenge the page can solve in a moment: the lowest difficulty the contract allows. */
export function challenge() {
  return {
    challenge: `${'a'.repeat(60)}.${'b'.repeat(42)}A`,
    difficulty: 8,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

export const notFound: Reply = {
  status: 404,
  body: {
    type: 'about:blank',
    title: 'Not found',
    status: 404,
    detail: 'Not found.',
    requestId: 'req_e2e',
  },
};

export const receipt = {
  status: 201,
  body: { responseId: RESPONSE_ID, confirmationMessage: 'Thanks from Funder A.' },
};

/** A form anyone can answer. Pass handlers to change what the API says. */
export function stubPublicForm(
  page: Page,
  more: Record<string, Handler> = {},
  funder?: Funder,
): Promise<SentRequest[]> {
  return stubApi(
    page,
    {
      [`GET ${PUBLIC}`]: { status: 200, body: publicForm },
      [`GET ${PUBLIC}/challenge`]: () => ({ status: 200, body: challenge() }),
      [`POST ${PUBLIC}/responses`]: receipt,
      ...more,
    },
    funder,
  );
}

export const PUBLIC_ROUTES = {
  form: `GET ${PUBLIC}`,
  challenge: `GET ${PUBLIC}/challenge`,
  submit: `POST ${PUBLIC}/responses`,
};

/** A signed-in applicant with forms switched on and allowed to answer. */
export function stubSignedInForms(
  page: Page,
  options: { modules?: string[]; saved?: Record<string, unknown> } = {},
  more: Record<string, Handler> = {},
): Promise<SentRequest[]> {
  const { modules = ['forms'] } = options;
  let draft = options.saved ?? {};
  const session = {
    ...applicantSession({ modules }),
    permissions: ['party.profile.manage', 'forms.responses.submit'],
  };
  const sentDraft = () => ({
    status: 200,
    body: {
      formVersionId: Object.keys(draft).length === 0 ? null : VERSION_ID,
      answers: draft,
      updatedAt: Object.keys(draft).length === 0 ? null : new Date().toISOString(),
    },
  });
  return stubApi(page, {
    'GET /auth/session': { status: 200, body: session },
    'POST /auth/sign-out': { status: 204 },
    'GET /portal/profile': { status: 404, body: notFound.body },
    [`GET ${PORTAL}`]: {
      status: 200,
      body: {
        id: FORM_ID,
        title: 'Funder A survey',
        description: '',
        closesAt: null,
        formVersionId: VERSION_ID,
        definition,
      },
    },
    [`GET ${PORTAL}/draft`]: sentDraft,
    [`PUT ${PORTAL}/draft`]: (body) => {
      draft = (body as { answers: Record<string, unknown> }).answers;
      return sentDraft();
    },
    [`POST ${PORTAL}/responses`]: () => ({
      status: 201,
      body: {
        responseId: RESPONSE_ID,
        submittedAt: new Date().toISOString(),
        confirmationMessage: '',
      },
    }),
    'GET /portal/form-responses': {
      status: 200,
      body: {
        responses: [
          {
            id: RESPONSE_ID,
            formId: FORM_ID,
            formTitle: 'Funder A survey',
            submittedAt: '2027-01-05T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    },
    [`GET /portal/form-responses/${RESPONSE_ID}`]: {
      status: 200,
      body: {
        id: RESPONSE_ID,
        formId: FORM_ID,
        formTitle: 'Funder A survey',
        submittedAt: '2027-01-05T10:00:00.000Z',
        formVersionId: VERSION_ID,
        definition,
        answers: { f_name: 'Sam' },
      },
    },
    ...more,
  });
}
