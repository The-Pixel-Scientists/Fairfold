// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, ErrorSummary } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import type { Decision, DecisionRow } from '../../contracts/index.ts';
import { problemLines } from '../assessment/problems.ts';
import { checkDraft, draftOf, rangeHint } from './draft.ts';
import type { AwardRange, Draft, Problems } from './draft.ts';
import { Failure } from './Failure.tsx';
import { AmountField, OutcomeField } from './fields.tsx';
import { record } from './loaders.ts';

const OUTCOME_ID = 'decision-outcome';
const AMOUNT_ID = 'decision-amount';

interface FormProps {
  row: DecisionRow;
  range: AwardRange;
  onClose: () => void;
  onRecorded: (decision: Decision) => void;
}

function DecisionForm({ row, range, onClose, onRecorded }: FormProps) {
  const [draft, setDraft] = useState<Draft>(draftOf(row.decision));
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<readonly string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const checked = checkDraft(draft, range);
    setFailure([]);
    if ('problems' in checked) {
      setProblems(checked.problems);
      setAttempt((count) => count + 1);
      return;
    }
    setProblems({});
    setPending(true);
    try {
      onRecorded(await record(row.submissionId, checked.input));
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  const summary = [
    ...(problems.outcome ? [{ fieldId: OUTCOME_ID, message: problems.outcome }] : []),
    ...(problems.amount ? [{ fieldId: AMOUNT_ID, message: problems.amount }] : []),
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
      <OutcomeField
        id={OUTCOME_ID}
        value={draft.outcome}
        error={problems.outcome}
        onChange={(outcome) => {
          setDraft({ ...draft, outcome });
        }}
      />
      {draft.outcome === 'accepted' && (
        <AmountField
          id={AMOUNT_ID}
          label="Amount to award"
          hint={rangeHint(range)}
          value={draft.amount}
          error={problems.amount}
          onChange={(amount) => {
            setDraft({ ...draft, amount });
          }}
        />
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
          Record decision
        </Button>
      </div>
    </form>
  );
}

export interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The submission to decide. The dialog stays closed without one. */
  row: DecisionRow | null;
  range: AwardRange;
  onRecorded: (row: DecisionRow, decision: Decision) => void;
}

/**
 * Records or changes one submission's decision. Recording keeps it private:
 * nothing is sent, and the applicant sees nothing, until decisions are released.
 */
export function DecisionDialog({
  open,
  onOpenChange,
  row,
  range,
  onRecorded,
}: DecisionDialogProps) {
  return (
    <Dialog
      open={open && row !== null}
      onOpenChange={onOpenChange}
      title={row?.decision ? 'Change decision' : 'Record decision'}
      description={
        row && (
          <>For {row.organisation.name}. It stays private to staff until you release decisions.</>
        )
      }
    >
      {row && (
        <DecisionForm
          key={row.submissionId}
          row={row}
          range={range}
          onClose={() => {
            onOpenChange(false);
          }}
          onRecorded={(decision) => {
            onRecorded(row, decision);
          }}
        />
      )}
    </Dialog>
  );
}
