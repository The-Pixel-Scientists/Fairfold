// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a decision is put in words and tags, so the page, the dialogs and the
// tests say the same thing. Colour only ever backs the words up.

import { Tag } from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';

import { decisionEmailStatuses, outcomes } from '../../contracts/index.ts';
import type { DecisionRow, Outcome } from '../../contracts/index.ts';

const outcomeTones: Readonly<Record<Outcome, TagTone>> = {
  accepted: 'success',
  waitlisted: 'warning',
  declined: 'danger',
};

export function OutcomeTag({ decision }: { decision: DecisionRow['decision'] }) {
  return decision === null ? (
    <span className="text-muted">No decision yet</span>
  ) : (
    <Tag tone={outcomeTones[decision.outcome]}>{outcomes[decision.outcome]}</Tag>
  );
}

/** Whether the applicant has been told, and how their email stands once they have. */
export function ReleaseState({ row }: { row: DecisionRow }) {
  const released = (row.decision?.releasedAt ?? null) !== null;
  return (
    <span className="flex flex-col items-start gap-1">
      <Tag tone={released ? 'success' : 'neutral'}>{released ? 'Released' : 'Not released'}</Tag>
      {row.email !== null && (
        <span className="text-sm font-normal text-muted">
          Email: {decisionEmailStatuses[row.email].toLowerCase()}
        </span>
      )}
    </span>
  );
}

/** A figure a row may not have yet. A screen reader hears the words, not a dash. */
export function Missing({ children }: { children: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-muted">
        –
      </span>
      <span className="sr-only">{children}</span>
    </>
  );
}
