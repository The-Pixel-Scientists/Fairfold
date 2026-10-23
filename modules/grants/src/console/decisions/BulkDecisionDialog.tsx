// SPDX-License-Identifier: AGPL-3.0-or-later

import { asProblem, Button, Dialog, ErrorSummary, FieldGroup } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { MAX_DECISIONS } from '../../contracts/index.ts';
import type { DecisionInput, DecisionRow, Outcome } from '../../contracts/index.ts';
import { problemLines } from '../assessment/problems.ts';
import { checkDraft, rangeHint } from './draft.ts';
import type { AwardRange } from './draft.ts';
import { Failure } from './Failure.tsx';
import { AmountField, OutcomeField } from './fields.tsx';
import { recordMany } from './loaders.ts';
import { countOf } from './totals.ts';

const OUTCOME_ID = 'bulk-outcome';
const amountId = (submissionId: string) => `bulk-amount-${submissionId}`;

/** Which row a field path such as `body.decisions.3.decision.amount` names. */
const ROW = /^body\.decisions\.(\d+)\./;

interface FormProps {
  roundId: string;
  /** The rows to decide, none of them released. */
  rows: readonly DecisionRow[];
  range: AwardRange;
  onClose: () => void;
  onRecorded: (recorded: number) => void;
}

function BulkForm({ roundId, rows, range, onClose, onRecorded }: FormProps) {
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [amounts, setAmounts] = useState<Readonly<Record<string, unknown>>>(() =>
    Object.fromEntries(rows.map((row) => [row.submissionId, row.decision?.amount ?? null])),
  );
  const [outcomeProblem, setOutcomeProblem] = useState<string>();
  const [amountProblems, setAmountProblems] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<readonly string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);

  const refuse = (
    problem: string | undefined,
    amountsWrong: Readonly<Record<string, string>>,
    lines: readonly string[] = [],
  ) => {
    setOutcomeProblem(problem);
    setAmountProblems(amountsWrong);
    setFailure(lines);
    setAttempt((count) => count + 1);
  };

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (outcome === '') {
      refuse('Choose an outcome.', {});
      return;
    }
    if (rows.length > MAX_DECISIONS) {
      refuse(undefined, {}, [
        `You can record up to ${String(MAX_DECISIONS)} decisions at once. Clear some of the selection and try again.`,
      ]);
      return;
    }
    const decisions: { submissionId: string; decision: DecisionInput }[] = [];
    const wrong: Record<string, string> = {};
    for (const { submissionId } of rows) {
      const checked = checkDraft({ outcome, amount: amounts[submissionId] }, range);
      if ('input' in checked) decisions.push({ submissionId, decision: checked.input });
      else if (checked.problems.amount) wrong[submissionId] = checked.problems.amount;
    }
    if (Object.keys(wrong).length > 0) {
      refuse(undefined, wrong);
      return;
    }

    setOutcomeProblem(undefined);
    setAmountProblems({});
    setFailure([]);
    setPending(true);
    try {
      onRecorded((await recordMany(roundId, decisions)).recorded);
    } catch (error) {
      const named: Record<string, string> = {};
      for (const { field, message } of asProblem(error)?.errors ?? []) {
        const row = rows[Number(ROW.exec(field)?.[1])];
        if (row && field.endsWith('.amount')) named[row.submissionId] = message;
      }
      refuse(undefined, named, Object.keys(named).length > 0 ? [] : problemLines(error));
    } finally {
      setPending(false);
    }
  }

  const summary = [
    ...(outcomeProblem ? [{ fieldId: OUTCOME_ID, message: outcomeProblem }] : []),
    ...rows.flatMap(({ submissionId, organisation }) =>
      amountProblems[submissionId]
        ? [
            {
              fieldId: amountId(submissionId),
              message: `${organisation.name}: ${amountProblems[submissionId]}`,
            },
          ]
        : [],
    ),
  ];

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
    >
      <ErrorSummary key={attempt} errors={summary} />
      <Failure lines={failure} />
      <OutcomeField id={OUTCOME_ID} value={outcome} error={outcomeProblem} onChange={setOutcome} />
      {outcome === 'accepted' && (
        <FieldGroup legend="Amount to award to each" hint={rangeHint(range)}>
          {rows.map(({ submissionId, organisation }) => (
            <AmountField
              key={submissionId}
              id={amountId(submissionId)}
              label={organisation.name}
              value={amounts[submissionId]}
              error={amountProblems[submissionId]}
              onChange={(amount) => {
                setAmounts({ ...amounts, [submissionId]: amount });
              }}
            />
          ))}
        </FieldGroup>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
          Record {countOf(rows.length, 'decision')}
        </Button>
      </div>
    </form>
  );
}

export interface BulkDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roundId: string;
  /** The rows chosen in the table. Released decisions are left as they are. */
  chosen: readonly DecisionRow[];
  range: AwardRange;
  onRecorded: (recorded: number) => void;
}

/** Records one outcome for every chosen submission, and an amount for each award, all or none. */
export function BulkDecisionDialog({
  open,
  onOpenChange,
  roundId,
  chosen,
  range,
  onRecorded,
}: BulkDecisionDialogProps) {
  const rows = chosen.filter((row) => (row.decision?.releasedAt ?? null) === null);
  const released = chosen.length - rows.length;
  return (
    <Dialog
      open={open && rows.length > 0}
      onOpenChange={onOpenChange}
      title="Record decisions"
      wide
      description={
        <>
          One outcome for {countOf(rows.length, 'submission')}. Nothing is recorded unless every one
          can be. Applicants see nothing until you release decisions.
          {released === 1 && ' One chosen decision is already released and stays as it is.'}
          {released > 1 &&
            ` ${String(released)} chosen decisions are already released and stay as they are.`}
        </>
      }
    >
      <BulkForm
        roundId={roundId}
        rows={rows}
        range={range}
        onClose={() => {
          onOpenChange(false);
        }}
        onRecorded={onRecorded}
      />
    </Dialog>
  );
}
