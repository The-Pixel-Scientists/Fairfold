// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, LoadingState, Panel, Tag, useCan, useLoad } from '@pixel-scientists/ui';
import { useState } from 'react';

import { adjustmentReasons } from '../../../contracts/index.ts';
import type {
  Adjustment,
  AdjustmentKind,
  Submission,
  SubmissionAdjustments,
} from '../../../contracts/index.ts';
import { formatMoment } from '../../programme/format.ts';
import { GrantDialog } from './GrantDialog.tsx';
import { loadSubmissionAdjustments } from './loaders.ts';
import { RevokeDialog } from './RevokeDialog.tsx';
import { useNotice } from './useNotice.tsx';
import { closingWords, givenWords, grantedWords } from './words.ts';

type Placed = Pick<Submission, 'id' | 'round' | 'organisation' | 'status'>;

function Item({ adjustment, onRevoke }: { adjustment: Adjustment; onRevoke: () => void }) {
  const { revoked } = adjustment;
  return (
    <li className="flex flex-col items-start gap-1 border-t border-divider pt-3 first:border-t-0 first:pt-0">
      <span className="text-body font-medium text-ink">{givenWords(adjustment)}</span>
      <span className="text-sm text-muted">
        {adjustmentReasons[adjustment.reasonCode]}. {grantedWords(adjustment)}.
      </span>
      {revoked === null ? (
        <Button onClick={onRevoke}>
          Remove<span className="sr-only"> {givenWords(adjustment)}</span>
        </Button>
      ) : (
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Tag tone="neutral">Removed</Tag>
          {revoked.by.name ?? 'A team member'}, {formatMoment(revoked.at, adjustment.timeZone)}
        </span>
      )}
    </li>
  );
}

function Body({ submission, initial }: { submission: Placed; initial: SubmissionAdjustments }) {
  const [list, setList] = useState(initial);
  const [giving, setGiving] = useState<AdjustmentKind | null>(null);
  const [removing, setRemoving] = useState<Adjustment | null>(null);
  const { notice, say, focus } = useNotice();
  const { timeZone } = list;

  /** The list from the API: the closing time follows from it by the server's one rule, never from a copy of it here. */
  const refresh = (said: string) => {
    say(said);
    void loadSubmissionAdjustments(submission.id).then(
      (next) => {
        setList(next);
        focus();
      },
      () => {
        say(`${said} Refresh the page to see the latest.`);
        focus();
      },
    );
  };

  return (
    <>
      {notice}
      <p className="text-body text-ink">Closes {closingWords(list.closesAt, timeZone)}.</p>
      {list.adjustments.length === 0 ? (
        <p className="text-body text-muted">
          No adjustments. Give more time if this organisation needs it.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.adjustments.map((adjustment) => (
            <Item
              key={adjustment.id}
              adjustment={adjustment}
              onRevoke={() => {
                setRemoving(adjustment);
              }}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setGiving('deadline_extension');
          }}
        >
          Give more time
        </Button>
        <Button
          onClick={() => {
            setGiving('alternative_route');
          }}
        >
          Let staff submit for them
        </Button>
      </div>
      <GrantDialog
        open={giving !== null}
        onOpenChange={(open) => {
          if (!open) setGiving(null);
        }}
        kind={giving ?? 'deadline_extension'}
        target={{
          roundId: submission.round.id,
          organisation: submission.organisation,
          applicationId: submission.id,
          closesAt: list.closesAt,
          timeZone,
        }}
        onGranted={(adjustment) => {
          setGiving(null);
          refresh(`${givenWords(adjustment)} given to ${adjustment.organisation.name}.`);
        }}
      />
      <RevokeDialog
        adjustment={removing}
        onClose={() => {
          setRemoving(null);
        }}
        onRevoked={(adjustment) => {
          setRemoving(null);
          refresh(`Adjustment removed for ${adjustment.organisation.name}.`);
        }}
      />
    </>
  );
}

function Adjustments({ submission }: { submission: Placed }) {
  const { state, retry } = useLoad(loadSubmissionAdjustments, submission.id);
  return (
    <Panel title="More time and adjustments">
      {state.status === 'loading' && <LoadingState label="Loading adjustments" />}
      {state.status === 'failed' && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-danger">{state.message}</p>
          <Button onClick={retry}>Try again</Button>
        </div>
      )}
      {state.status === 'ready' && <Body submission={submission} initial={state.value} />}
    </Panel>
  );
}

/** When a submission closes, the adjustments behind it and a way to give or remove them. Only for someone who may manage adjustments. */
export function AdjustmentsPanel({ submission }: { submission: Placed }) {
  return useCan('grants.adjustments.manage') ? (
    <Adjustments key={submission.id} submission={submission} />
  ) : null;
}
