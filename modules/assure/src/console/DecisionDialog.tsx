// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  Dialog,
  ErrorSummary,
  FormField,
  RadioGroup,
  Select,
  useSubmit,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { matchOutcomes, matchReasons } from '../contracts/index.ts';
import type { MatchDecision, MatchOutcome } from '../contracts/index.ts';
import { decideMatch } from './loaders.ts';
import { useStepUp } from './useStepUp.tsx';
import { outcomeWords, reasonWords } from './words.ts';

export interface DecisionDialogProps {
  matchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the decision the server recorded. */
  onDecided: (decision: MatchDecision) => void;
}

const FIELDS = ['outcome', 'reason'] as const;

export function DecisionDialog({ matchId, open, onOpenChange, onDecided }: DecisionDialogProps) {
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const stepUp = useStepUp();
  const reasons: readonly string[] = (matchOutcomes as readonly string[]).includes(outcome)
    ? matchReasons[outcome as MatchOutcome]
    : [];

  // The answers live here, not in the dialog, so a round trip to confirm sign-in keeps them.
  const form = useSubmit(FIELDS, async () => {
    const decision = await stepUp.run(() => decideMatch(matchId, { outcome, reason }));
    if (decision === null) return;
    onDecided(decision);
    onOpenChange(false);
    setOutcome('');
    setReason('');
  });

  return (
    <>
      <Dialog
        open={open && !stepUp.asking}
        onOpenChange={onOpenChange}
        title="Record decision"
        description="This match is advisory. Recording a decision does not reject, block or pay anything. It records what you decided and why, under your name."
      >
        <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
          <ErrorSummary key={form.attempt} errors={form.errors} />
          <RadioGroup
            legend="Your decision"
            name="outcome"
            id="outcome"
            value={outcome}
            onValueChange={(value) => {
              setOutcome(value);
              setReason('');
            }}
            options={matchOutcomes.map((value) => ({ value, label: outcomeWords[value] }))}
            error={form.errorFor('outcome')}
          />
          <FormField label="Reason" id="reason" error={form.errorFor('reason')}>
            <Select
              name="reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            >
              <option value="">
                {reasons.length === 0 ? 'Choose your decision first' : 'Choose a reason'}
              </option>
              {reasons.map((code) => (
                <option key={code} value={code}>
                  {reasonWords[code as keyof typeof reasonWords]}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
              Confirm decision
            </Button>
          </div>
        </form>
      </Dialog>
      {stepUp.dialog}
    </>
  );
}
