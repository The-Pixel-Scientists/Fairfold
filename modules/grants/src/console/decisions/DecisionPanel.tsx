// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  Button,
  buttonClassName,
  Link,
  LoadingState,
  Panel,
  useCan,
  useLoad,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import type { DecisionList, Submission } from '../../contracts/index.ts';
import { problemLines } from '../assessment/problems.ts';
import { formatMoment } from '../programme/format.ts';
import { DecisionDialog } from './DecisionDialog.tsx';
import { loadDecisions } from './loaders.ts';
import { decisionsPath } from './paths.ts';
import { OutcomeTag } from './words.tsx';

type Placed = Pick<Submission, 'id' | 'status' | 'round'>;

function Body({ submission, initial }: { submission: Placed; initial: DecisionList }) {
  const [list, setList] = useState(initial);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const row = list.submissions.find(({ submissionId }) => submissionId === submission.id) ?? null;
  const decision = row?.decision ?? null;
  const releasedAt = decision?.releasedAt ?? null;

  return (
    <>
      <p role="status" className="text-body text-ink empty:hidden">
        {notice}
      </p>
      {decision === null ? (
        <p className="text-body text-muted">
          {submission.status === 'withdrawn'
            ? 'This submission was withdrawn, so it cannot be given a decision.'
            : 'No decision yet. Recording one keeps it private to staff.'}
        </p>
      ) : (
        <div className="flex flex-col items-start gap-1">
          <OutcomeTag decision={decision} />
          {decision.amount && (
            <p className="text-body text-ink">Award of {formatMoney(decision.amount)}</p>
          )}
          <p className="text-sm text-muted">
            {releasedAt === null
              ? 'Private: the applicant sees nothing until decisions are released.'
              : `Released on ${formatMoment(releasedAt)}.`}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {row && releasedAt === null && (
          <Button
            variant="primary"
            onClick={() => {
              setRecording(true);
            }}
          >
            {decision ? 'Change decision' : 'Record decision'}
          </Button>
        )}
        <Link to={decisionsPath(submission.round.id)} className={buttonClassName()}>
          All decisions in this round
        </Link>
      </div>
      <DecisionDialog
        open={recording}
        onOpenChange={setRecording}
        row={row}
        range={list.round}
        onRecorded={(recorded) => {
          setRecording(false);
          loadDecisions(submission.round.id).then(
            (next) => {
              setList(next);
              setNotice(
                `Decision recorded for ${recorded.organisation.name}. Only staff can see it.`,
              );
            },
            (error: unknown) => {
              setNotice(
                `Decision recorded. The panel could not be refreshed: ${problemLines(error).join(' ')}`,
              );
            },
          );
        }}
      />
    </>
  );
}

function Decision({ submission }: { submission: Placed }) {
  const { state, retry } = useLoad(loadDecisions, submission.round.id);
  return (
    <Panel title="Decision">
      {state.status === 'loading' && <LoadingState label="Loading the decision" />}
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

/** A submission's decision, with a way to record or change it, beside its answers. Only for someone who can record decisions. */
export function DecisionPanel({ submission }: { submission: Placed }) {
  return useCan('grants.decisions.record') ? (
    <Decision key={submission.id} submission={submission} />
  ) : null;
}
