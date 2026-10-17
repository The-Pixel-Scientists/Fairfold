// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Recording and changing decisions (ADR 0004, architecture rules 8 and 9).
// A decision is private: nothing here tells the applicant or sends an email.
// Every item is checked before any is written, so a request records all of
// its decisions or none. The applications are locked in id order, so a
// withdrawal or a second request waits its turn; a release in flight holds
// its decisions, and the update then finds them released. The database
// refuses a decision on an application that is not submitted and any change
// to a released one; the checks here say why in plain words.

import { formatMoney, messages, type FieldProblem } from '@pixel-scientists/domain/platform';

import type {
  BulkDecisionInput,
  Decision,
  DecisionInput,
  Recorded,
} from '../../contracts/index.ts';
import { readRound } from '../programme/read.ts';
import type { DecisionArgs, DecisionDependencies } from './context.ts';
import { toDecision } from './read.ts';
import { decisionsDb } from './tables.ts';

const refusals = {
  missing: 'This is not a submission in this round. Remove it and try again.',
  withdrawn:
    'This submission was withdrawn, so it cannot be given a decision. Remove it and try again.',
  released: 'This decision has been released, so it can no longer change.',
  none: 'No decisions were recorded. Fix the ones listed and try again.',
} as const;

interface Item {
  readonly submissionId: string;
  readonly decision: DecisionInput;
  /** The path of the decision in the request, for the problems it causes. */
  readonly field: string;
}

const column = (name: string) => `grants.decision.${name}`;

const asNumber = (amountMinor: string | null) =>
  amountMinor === null ? null : Number(amountMinor);

export function recordHandlers(deps: DecisionDependencies) {
  /** Records or changes each item's decision, and returns how many differed from what was there. */
  async function recordItems(
    { tx, context }: Pick<DecisionArgs<unknown>, 'tx' | 'context'>,
    roundId: string,
    items: readonly Item[],
  ): Promise<number> {
    const round = await readRound(tx, roundId);
    if (round === undefined) throw deps.notFound();
    const db = decisionsDb(tx);
    const ids = items.map((item) => item.submissionId);
    const applications = new Map(
      (
        await db
          .selectFrom('grants.application')
          .select(['id', 'round_id', 'status'])
          .where('id', 'in', ids)
          .orderBy('id')
          .forUpdate()
          .execute()
      ).map((row) => [row.id, row]),
    );
    const before = new Map(
      (
        await db
          .selectFrom('grants.decision')
          .select(['id', 'application_id', 'outcome', 'amount_minor', 'released_at'])
          .where('application_id', 'in', ids)
          .execute()
      ).map((row) => [row.application_id, row]),
    );

    const range = `Enter an amount between ${formatMoney(round.awardMinimum)} and ${formatMoney(round.awardMaximum)}.`;
    const outOfRange: FieldProblem[] = [];
    const unfit: FieldProblem[] = [];
    for (const { submissionId, decision, field } of items) {
      const application = applications.get(submissionId);
      const message =
        application === undefined ||
        application.status === 'draft' ||
        application.round_id !== roundId
          ? refusals.missing
          : application.status === 'withdrawn'
            ? refusals.withdrawn
            : before.get(submissionId)?.released_at
              ? refusals.released
              : undefined;
      if (message !== undefined) {
        unfit.push({ field, message });
      } else if (
        decision.outcome === 'accepted' &&
        (decision.amount.amountMinor < round.awardMinimum.amountMinor ||
          decision.amount.amountMinor > round.awardMaximum.amountMinor)
      ) {
        outOfRange.push({ field: `${field}.amount`, message: range });
      }
    }
    const problems = outOfRange.length > 0 ? outOfRange : unfit;
    const [first] = problems;
    if (first !== undefined) {
      const detail =
        items.length === 1
          ? first.message
          : outOfRange.length > 0
            ? messages.fixFields
            : refusals.none;
      throw deps.refuse(outOfRange.length > 0 ? 400 : 409, detail, problems);
    }

    const actor = context.membership.id;
    let written = 0;
    for (const { submissionId, decision } of items) {
      const amountMinor = decision.outcome === 'accepted' ? decision.amount.amountMinor : null;
      const previous = before.get(submissionId);
      if (
        previous?.outcome === decision.outcome &&
        asNumber(previous.amount_minor) === amountMinor
      ) {
        continue;
      }
      const values = {
        outcome: decision.outcome,
        amount_minor: amountMinor,
        currency: decision.outcome === 'accepted' ? decision.amount.currency : null,
        recorded_by: actor,
        updated_by: actor,
      };
      let id: string | undefined;
      if (previous === undefined) {
        ({ id } = await db
          .insertInto('grants.decision')
          .values((eb) => ({
            ...values,
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            application_id: submissionId,
            created_by: actor,
          }))
          .returning('id')
          .executeTakeFirstOrThrow());
      } else {
        id = (
          await db
            .updateTable('grants.decision')
            .set(values)
            .where('id', '=', previous.id)
            .returning('id')
            .executeTakeFirst()
        )?.id;
        // A release that committed first leaves no unreleased row to update.
        if (id === undefined) throw deps.refuse(409, refusals.released);
      }
      await context.audit.record({
        action: previous === undefined ? 'grants.decision.recorded' : 'grants.decision.changed',
        entityId: id,
        changes: {
          [column('outcome')]: { before: previous?.outcome ?? null, after: decision.outcome },
          [column('amount_minor')]: {
            before: asNumber(previous?.amount_minor ?? null),
            after: amountMinor,
          },
        },
      });
      written++;
    }
    return written;
  }

  async function recordDecision({
    tx,
    context,
    input,
  }: DecisionArgs<{ params: { submissionId: string }; body: DecisionInput }>): Promise<Decision> {
    const { submissionId } = input.params;
    const application = await decisionsDb(tx)
      .selectFrom('grants.application')
      .select('round_id')
      .where('id', '=', submissionId)
      .where('status', '<>', 'draft')
      .executeTakeFirst();
    if (application === undefined) throw deps.notFound();
    await recordItems({ tx, context }, application.round_id, [
      { submissionId, decision: input.body, field: 'body' },
    ]);
    const row = await decisionsDb(tx)
      .selectFrom('grants.decision')
      .select(['outcome', 'amount_minor', 'recorded_at', 'released_at'])
      .where('application_id', '=', submissionId)
      .executeTakeFirstOrThrow();
    return toDecision(row);
  }

  async function recordDecisions({
    tx,
    context,
    input,
  }: DecisionArgs<{ params: { roundId: string }; body: BulkDecisionInput }>): Promise<Recorded> {
    const recorded = await recordItems(
      { tx, context },
      input.params.roundId,
      input.body.decisions.map(({ submissionId, decision }, index) => ({
        submissionId,
        decision,
        field: `body.decisions.${index}.decision`,
      })),
    );
    return { recorded };
  }

  return { recordDecision, recordDecisions };
}
