// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The staff response routes' handlers: list, count, read, find by reference,
// and mark or unmark spam. Answers leave only through the staff projection of
// the version the response pinned (rule 7), so aggregate-only answers never
// reach staff. Reading one response, however it was found, is a sensitive
// read and writes `forms.response.viewed` in the request's transaction, with
// the respondent's party as its subject when there is one (ADR 0027). Marking
// takes the response's row lock first, writes nothing when the mark would not
// change, and otherwise writes its event with the reason code and no answer.
// Code never marks a response itself (rule 9).

import { projectedAnswers } from '@pixel-scientists/domain/api';
import { answersSchema, formDefinitionSchema } from '@pixel-scientists/domain/forms';

import type {
  FormResponse,
  ResponseRoute,
  ResponseSummary,
  SpamReason,
} from '../../contracts/index.ts';
import { tokenHash } from '../public/hash.ts';
import { decodeCursor, encodeCursor } from '../staff/forms.ts';
import {
  responseRefusals,
  type Args,
  type DetailRow,
  type Filters,
  type ResponseDependencies,
  type SummaryRow,
} from './context.ts';

const PAGE_SIZE = 50;

export interface TotalsQuery {
  readonly formVersionId?: string;
  readonly submittedFrom?: string;
  readonly submittedTo?: string;
  readonly route?: ResponseRoute;
}

export interface Query extends TotalsQuery {
  readonly view: 'received' | 'without_check' | 'spam';
  readonly cursor?: string;
}

const time = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

const filtersOf = (query: TotalsQuery): Filters => ({
  formVersionId: query.formVersionId,
  submittedFrom: time(query.submittedFrom),
  submittedTo: time(query.submittedTo),
  route: query.route,
});

export function toSummary(row: SummaryRow): ResponseSummary {
  return {
    id: row.id,
    formId: row.formId,
    formVersionId: row.formVersionId,
    version: row.version,
    route: row.route,
    personId: row.personId,
    submittedAt: row.submittedAt.toISOString(),
    sentWithoutCheck: row.sentWithoutCheck,
    spamReason: row.spamReason,
  };
}

function toResponse(row: DetailRow): FormResponse {
  const definition = formDefinitionSchema.safeParse(row.definition);
  const answers = answersSchema.safeParse(row.answers);
  // The errors are not passed on: they could repeat a stored value.
  if (!definition.success || !answers.success) throw new Error('A stored response does not parse.');
  return {
    ...toSummary(row),
    definition: definition.data,
    answers: projectedAnswers(definition.data, answers.data, 'staff'),
  };
}

export function staffResponseHandlers<Tx>(deps: ResponseDependencies<Tx>) {
  async function read(tx: Tx, responseId: string, lock = false): Promise<DetailRow> {
    return (await deps.store(tx).find(responseId, lock)) ?? Promise.reject(deps.notFound());
  }

  async function formOf(tx: Tx, formId: string): Promise<void> {
    if (!(await deps.store(tx).formExists(formId))) throw deps.notFound();
  }

  /** The response as staff read it, recorded as a sensitive read. */
  async function viewed({ context }: Pick<Args<Tx, unknown>, 'context'>, row: DetailRow) {
    await context.audit.read({
      action: 'forms.response.viewed',
      entityId: row.id,
      ...(row.personId === null ? {} : { subjectPartyId: row.personId }),
    });
    return toResponse(row);
  }

  async function listResponses({
    tx,
    input,
  }: Args<Tx, { params: { formId: string }; query: Query }>) {
    const { formId } = input.params;
    const { view, cursor } = input.query;
    const after = cursor === undefined ? null : decodeCursor(cursor);
    if (after === undefined) throw deps.refuse(400, responseRefusals.cursor);
    await formOf(tx, formId);
    const rows = await deps
      .store(tx)
      .list(
        formId,
        view,
        filtersOf(input.query),
        after === null ? null : { submittedAt: after.updatedAt, id: after.id },
        PAGE_SIZE + 1,
      );
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      responses: page.map(toSummary),
      nextCursor:
        rows.length > PAGE_SIZE && last !== undefined
          ? encodeCursor({ updatedAt: last.submittedAt, id: last.id })
          : null,
    };
  }

  async function getResponseTotals({
    tx,
    input,
  }: Args<Tx, { params: { formId: string }; query: TotalsQuery }>) {
    await formOf(tx, input.params.formId);
    return deps.store(tx).totals(input.params.formId, filtersOf(input.query));
  }

  async function getResponse(args: Args<Tx, { params: { responseId: string } }>) {
    return viewed(args, await read(args.tx, args.input.params.responseId));
  }

  async function findResponseByReference(args: Args<Tx, { body: { reference: string } }>) {
    if (deps.hashKey === undefined) throw deps.notFound();
    const found = await deps
      .store(args.tx)
      .findByToken(await tokenHash(deps.hashKey, args.input.body.reference));
    if (found === undefined) throw deps.notFound();
    return viewed(args, found);
  }

  /** Sets or clears the spam mark; a request that would change nothing writes nothing. */
  async function mark(
    { tx, context }: Pick<Args<Tx, unknown>, 'tx' | 'context'>,
    responseId: string,
    reason: SpamReason | null,
  ): Promise<ResponseSummary> {
    const found = await read(tx, responseId, true);
    if (found.spamReason !== reason) {
      await deps.store(tx).setSpam(responseId, reason, context.membership.id);
      await context.audit.record({
        action: reason === null ? 'forms.response.unmarked_spam' : 'forms.response.marked_spam',
        entityId: responseId,
        changes: { 'forms.response.spam_reason': { before: found.spamReason, after: reason } },
        ...(found.personId === null ? {} : { subjectPartyId: found.personId }),
      });
    }
    return toSummary({ ...found, spamReason: reason });
  }

  const markResponseSpam = (
    args: Args<Tx, { params: { responseId: string }; body: { reason: SpamReason } }>,
  ) => mark(args, args.input.params.responseId, args.input.body.reason);

  const unmarkResponseSpam = (args: Args<Tx, { params: { responseId: string } }>) =>
    mark(args, args.input.params.responseId, null);

  return {
    listResponses,
    getResponseTotals,
    getResponse,
    findResponseByReference,
    markResponseSpam,
    unmarkResponseSpam,
  };
}
