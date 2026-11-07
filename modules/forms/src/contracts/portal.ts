// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signed-in respondents in the portal (ADR 0004), under
// `forms.responses.submit`. The person is the session's, never a body or URL
// value (rule 6). Forms are reached through `open_form`: one taking
// signed-in answers, published, opened and not closed. Responses are
// reached through `own_response`: the caller's own. Anything else answers
// 404, as if it did not exist.
//
// - Each person has at most one draft per form, pinned to the version they
//   started on and keyed by stable field ids. Saving it is the person's own
//   unsaved work and is not audited.
// - Submitting checks the answers with validateAnswers() against the version
//   named, which must be a published version of the form taking signed-in
//   answers, or the form-changed problem answers (public.ts). It writes
//   `forms.response.submitted`, with the subject party id in the audit
//   context (ADR 0027), and removes the draft.
// - A person reads their own responses projected for the respondent, which
//   carry no staff data, spam state or anyone else's answers.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { answersSchema, formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { classified, cursorSchema, timestampSchema } from './schemas.ts';

/** The answers and the version they answer. */
export const portalAnswersInputSchema = z.strictObject({
  formVersionId: idSchema,
  answers: answersSchema,
});

export type PortalAnswersInput = z.infer<typeof portalAnswersInputSchema>;

/** The form to answer, with its latest version for signed-in answers. */
export const portalFormSchema = classified(
  z.strictObject({
    id: idSchema,
    title: z.string(),
    description: z.string(),
    closesAt: timestampSchema.nullable(),
    formVersionId: idSchema,
    definition: formDefinitionSchema,
  }),
  {
    id: 'public',
    title: 'public',
    description: 'public',
    closesAt: 'public',
    formVersionId: 'public',
    definition: 'public',
  },
);

/** The caller's draft, or no version, no answers and no time when they have not saved one. */
export const portalDraftSchema = classified(
  z.strictObject({
    formVersionId: idSchema.nullable(),
    answers: projectedAnswersSchemas.respondent,
    updatedAt: timestampSchema.nullable(),
  }),
  { formVersionId: 'internal', answers: 'answers', updatedAt: 'internal' },
);

/** Empty text means the page's own thanks. */
export const portalReceiptSchema = classified(
  z.strictObject({
    responseId: idSchema,
    submittedAt: timestampSchema,
    confirmationMessage: z.string(),
  }),
  { responseId: 'internal', submittedAt: 'internal', confirmationMessage: 'public' },
);

const summaryShape = {
  id: idSchema,
  formId: idSchema,
  formTitle: z.string(),
  submittedAt: timestampSchema,
};

const summaryClasses = {
  id: 'internal',
  formId: 'internal',
  formTitle: 'public',
  submittedAt: 'internal',
} as const;

/** The newest first. */
export const myResponsePageSchema = classified(
  z.strictObject({
    responses: z.array(classified(z.strictObject(summaryShape), summaryClasses)),
    nextCursor: cursorSchema.nullable(),
  }),
  { responses: 'internal', nextCursor: 'internal' },
);

/** One of the caller's responses, with its pinned version and their answers as they may see them. */
export const myResponseSchema = classified(
  z.strictObject({
    ...summaryShape,
    formVersionId: idSchema,
    definition: formDefinitionSchema,
    answers: projectedAnswersSchemas.respondent,
  }),
  { ...summaryClasses, formVersionId: 'internal', definition: 'public', answers: 'answers' },
);

const submit = {
  audience: 'portal',
  module: 'forms',
  permission: 'forms.responses.submit',
} as const;

const openForm = {
  ...submit,
  scope: 'open_form',
  params: z.strictObject({ formId: idSchema }),
} as const;

const mine = { ...submit, scope: 'own_response' } as const;

export const getPortalForm = defineRoute({
  ...openForm,
  method: 'GET',
  path: '/portal/forms/:formId',
  summary: 'Read a form taking answers from people who sign in',
  responses: { 200: portalFormSchema },
});

export const getMyFormDraft = defineRoute({
  ...openForm,
  method: 'GET',
  path: '/portal/forms/:formId/draft',
  summary: "Read the caller's saved answers to a form",
  responses: { 200: portalDraftSchema },
});

export const saveMyFormDraft = defineRoute({
  ...openForm,
  method: 'PUT',
  path: '/portal/forms/:formId/draft',
  summary: "Replace the caller's saved answers to a form",
  body: portalAnswersInputSchema,
  responses: { 200: portalDraftSchema },
});

export const submitMyResponse = defineRoute({
  ...openForm,
  method: 'POST',
  idempotent: true,
  path: '/portal/forms/:formId/responses',
  summary: "Send the caller's response to a form, checked against the version answered",
  body: portalAnswersInputSchema,
  responses: { 201: portalReceiptSchema },
});

export const listMyResponses = defineRoute({
  ...mine,
  method: 'GET',
  path: '/portal/form-responses',
  summary: "List the caller's responses, the newest first, a page at a time",
  query: z.strictObject({ cursor: cursorSchema.optional() }),
  responses: { 200: myResponsePageSchema },
});

export const getMyResponse = defineRoute({
  ...mine,
  params: z.strictObject({ responseId: idSchema }),
  method: 'GET',
  path: '/portal/form-responses/:responseId',
  summary: "Read one of the caller's responses with their answers",
  responses: { 200: myResponseSchema },
});

export const portalFormRoutes = {
  getPortalForm,
  getMyFormDraft,
  saveMyFormDraft,
  submitMyResponse,
  listMyResponses,
  getMyResponse,
} as const;
