// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, useCan } from '@pixel-scientists/ui';
import { useState } from 'react';

import type { AutomaticAssignResult, SubmissionSummary } from '../../contracts/index.ts';
import { AssignDialog } from './AssignDialog.tsx';
import { AutomaticDialog, summaryOf } from './AutomaticDialog.tsx';
import { targetOf } from './target.ts';
import { countOf } from './words.ts';

export interface AssignActionsProps {
  /** The submissions chosen in the list. */
  chosen: readonly SubmissionSummary[];
  /** Called with a sentence saying what was done, once an assignment is made. */
  onDone: (notice: string) => void;
}

/** The list's actions for assigning reviewers to the chosen submissions, by hand or automatically. Only for someone who can assign. */
export function AssignActions({ chosen, onDone }: AssignActionsProps) {
  const canAssign = useCan('grants.reviews.assign');
  const [dialog, setDialog] = useState<'hand' | 'automatic' | null>(null);
  if (!canAssign) return null;

  const target = targetOf(chosen);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const names = chosen.map(({ id, organisation }) => ({ id, name: organisation.name }));

  return (
    <>
      <Button
        disabled={chosen.length === 0}
        onClick={() => {
          setDialog('hand');
        }}
      >
        Assign reviewers
      </Button>
      <Button
        disabled={chosen.length === 0}
        onClick={() => {
          setDialog('automatic');
        }}
      >
        Assign automatically
      </Button>
      <AssignDialog
        open={dialog === 'hand' && chosen.length > 0}
        onOpenChange={close}
        target={target}
        submissionIds={chosen.map(({ id }) => id)}
        onAssigned={({ assigned }) => {
          setDialog(null);
          onDone(`${countOf(assigned, 'review')} assigned.`);
        }}
      />
      <AutomaticDialog
        open={dialog === 'automatic' && chosen.length > 0}
        onOpenChange={close}
        target={target}
        submissions={names}
        onDone={(result: AutomaticAssignResult) => {
          onDone(summaryOf(result));
        }}
      />
    </>
  );
}
