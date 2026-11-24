// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The portal response routes' handlers, for a signed-in respondent. The
// person is the session's own, found from the account and made on the first
// save or submission, never taken from a request (rule 6). Answers are keyed
// by field id and checked against the version named, which must be a
// published version of the form taking signed-in answers, or the
// form-changed problem answers (rule 7). A draft is the person's own unsaved
// work and is not audited; a submission writes `forms.response.submitted`
// with ids only and the person as its subject (ADR 0027). Nothing here
// reads another person's response, and a person reads their own only through
// the respondent projection, which carries no staff data.
//
// A file question's answer is the ids of linked files, which the server adds
// from a join table (ADR 0047). Responses have none yet, so an answer to a
// file question is refused rather than stored unlinked.

import { projectedAnswers, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import {
  answersSchema,
  cleanAnswers,
  formDefinitionSchema,
  questionsOf,
  validateAnswers,
  type Answers,
  type FormDefinition,
} from '@pixel-scientists/domain/forms';
import { messages, type FieldProblem } from '@pixel-scientists/domain/platform';

import {
  getMyResponse as getMyResponseRoute,
  getPortalForm as getPortalFormRoute,
} from '../../contracts/index.ts';
import type { PortalAnswersInput } from '../../contracts/index.ts';
import { decodeCursor, encodeCursor } from '../staff/forms.ts';
import {
  responseRefusals,
  type Args,
  type ResponseContext,
  type ResponseDependencies,
} from './context.ts';

const PAGE_SIZE = 50;

const iso = (time: Date): string => time.toISOString();

function definitionOf(stored: unknown): FormDefinition {
  const parsed = formDefinitionSchema.safeParse(stored);
  // The error is not passed on: it could repeat a stored value.
  if (!parsed.success) throw new Error('A published form version does not parse.');
  return parsed.data;
}

function answersOf(stored: unknown): Answers {
  const parsed = answersSchema.safeParse(stored);
  if (!parsed.success) throw new Error('Stored answers do not parse.');
  return parsed.data;
}

export function portalResponseHandlers<Tx>(deps: ResponseDependencies<Tx>) {
  const store = (tx: Tx) => deps.store(tx);

  async function ownPerson(tx: Tx, context: ResponseContext): Promise<string> {
    const { userId, email } = context.session;
    const found = await store(tx).personFor(userId);
    if (found !== null) return found;
    const { personId, created } = await deps.ensurePerson(tx, { userId, email: await email() });
    if (created) {
      await context.audit.record({
        action: 'party.person.created',
        entityId: personId,
        changes: { 'party.person.email': {}, 'party.person.user_id': {} },
      });
    }
    return personId;
  }

  /** The answers cleaned and checked against the version named, or the problem to send. */
  async function checked(
    tx: Tx,
    formId: string,
    { formVersionId, answers }: PortalAnswersInput,
    mode: 'draft' | 'submit',
  ): Promise<Answers> {
    const version = await store(tx).signedInVersion(formId, formVersionId);
    if (version === undefined) throw deps.formChanged();
    const definition = definitionOf(version.definition);
    const cleaned = cleanAnswers(definition, answers);
    const files: FieldProblem[] = questionsOf(definition)
      .filter(({ type, id }) => type === 'file' && (cleaned[id] ?? null) !== null)
      .map(({ id }) => ({ field: id, message: responseRefusals.noFiles }));
    const problems = [...files, ...validateAnswers(definition, cleaned, mode)];
    if (problems.length > 0) throw deps.refuse(400, messages.fixFields, problems);
    return cleaned;
  }

  async function getPortalForm({ tx, input }: Args<Tx, { params: { formId: string } }>) {
    const form = await store(tx).openForm(input.params.formId);
    if (form === undefined) throw deps.notFound();
    return {
      id: form.id,
      title: form.title,
      description: form.description ?? '',
      closesAt: form.closesAt === null ? null : iso(form.closesAt),
      formVersionId: form.formVersionId,
      definition: definitionOf(form.definition),
    };
  }

  async function getMyFormDraft({ tx, context, input }: Args<Tx, { params: { formId: string } }>) {
    const personId = await store(tx).personFor(context.session.userId);
    const draft =
      personId === null ? undefined : await store(tx).draft(input.params.formId, personId);
    if (draft === undefined) {
      return {
        formVersionId: null,
        answers: projectedAnswersSchemas.respondent.parse({}),
        updatedAt: null,
      };
    }
    return {
      formVersionId: draft.formVersionId,
      answers: projectedAnswers(
        definitionOf(draft.definition),
        answersOf(draft.answers),
        'respondent',
      ),
      updatedAt: iso(draft.updatedAt),
    };
  }

  async function saveMyFormDraft({
    tx,
    context,
    input,
  }: Args<Tx, { params: { formId: string }; body: PortalAnswersInput }>) {
    const { formId } = input.params;
    const answers = await checked(tx, formId, input.body, 'draft');
    const personId = await ownPerson(tx, context);
    const saved = await store(tx).saveDraft(
      formId,
      personId,
      input.body.formVersionId,
      answers,
      context.membership.id,
    );
    return {
      formVersionId: saved.formVersionId,
      answers: projectedAnswers(
        definitionOf(saved.definition),
        answersOf(saved.answers),
        'respondent',
      ),
      updatedAt: iso(saved.updatedAt),
    };
  }

  async function receipt(tx: Tx, responseId: string, personId: string) {
    const found = await store(tx).receipt(responseId, personId);
    if (found === undefined) throw deps.notFound();
    return {
      responseId: found.responseId,
      submittedAt: iso(found.submittedAt),
      confirmationMessage: found.confirmationMessage,
    };
  }

  async function submitMyResponse({
    tx,
    context,
    input,
  }: Args<Tx, { params: { formId: string }; body: PortalAnswersInput }>) {
    const { formId } = input.params;
    const answers = await checked(tx, formId, input.body, 'submit');
    const personId = await ownPerson(tx, context);
    const responseId = await store(tx).submit(
      formId,
      personId,
      input.body.formVersionId,
      answers,
      context.membership.id,
    );
    await context.audit.record({
      action: 'forms.response.submitted',
      entityId: responseId,
      changes: {
        'forms.response.form_id': { after: formId },
        'forms.response.form_version_id': { after: input.body.formVersionId },
      },
      subjectPartyId: personId,
    });
    return receipt(tx, responseId, personId);
  }

  /** What a repeat of a submission answers: the receipt of the response the first one made. */
  async function replaySubmission({
    tx,
    context,
    id,
  }: Args<Tx, unknown> & { readonly id: string }) {
    const personId = await store(tx).personFor(context.session.userId);
    if (personId === null) throw deps.notFound();
    return receipt(tx, id, personId);
  }

  async function listMyResponses({ tx, context, input }: Args<Tx, { query: { cursor?: string } }>) {
    const { cursor } = input.query;
    const after = cursor === undefined ? null : decodeCursor(cursor);
    if (after === undefined) throw deps.refuse(400, responseRefusals.cursor);
    const personId = await store(tx).personFor(context.session.userId);
    const rows =
      personId === null
        ? []
        : await store(tx).own(
            personId,
            after === null ? null : { submittedAt: after.updatedAt, id: after.id },
            PAGE_SIZE + 1,
          );
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      responses: page.map(({ id, formId, formTitle, submittedAt }) => ({
        id,
        formId,
        formTitle,
        submittedAt: iso(submittedAt),
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last !== undefined
          ? encodeCursor({ updatedAt: last.submittedAt, id: last.id })
          : null,
    };
  }

  async function getMyResponse({
    tx,
    context,
    input,
  }: Args<Tx, { params: { responseId: string } }>) {
    const personId = await store(tx).personFor(context.session.userId);
    const found =
      personId === null ? undefined : await store(tx).ownOne(input.params.responseId, personId);
    if (found === undefined) throw deps.notFound();
    const definition = definitionOf(found.definition);
    return {
      id: found.id,
      formId: found.formId,
      formTitle: found.formTitle,
      submittedAt: iso(found.submittedAt),
      formVersionId: found.formVersionId,
      definition,
      answers: projectedAnswers(definition, answersOf(found.answers), 'respondent'),
    };
  }

  return {
    getPortalForm,
    getMyFormDraft,
    saveMyFormDraft,
    submitMyResponse,
    replaySubmission,
    listMyResponses,
    getMyResponse,
  };
}

/**
 * The portal routes' scope rules (ADR 0004): a form that takes signed-in
 * answers now, and the caller's own responses. A list names no response, and
 * its handler lists only the caller's own.
 */
export function portalResolvers<Tx>({ store }: Pick<ResponseDependencies<Tx>, 'store'>) {
  return {
    open_form: async ({ tx, input }: { tx: Tx; input: { params: unknown } }) => {
      const params = getPortalFormRoute.params.safeParse(input.params);
      return params.success && (await store(tx).openForm(params.data.formId)) !== undefined;
    },
    own_response: async ({
      tx,
      userId,
      input,
    }: {
      tx: Tx;
      userId: string;
      input: { params: unknown };
    }) => {
      if (input.params === undefined) return true;
      const params = getMyResponseRoute.params.safeParse(input.params);
      const personId = await store(tx).personFor(userId);
      return (
        params.success &&
        personId !== null &&
        (await store(tx).ownOne(params.data.responseId, personId)) !== undefined
      );
    },
  };
}
