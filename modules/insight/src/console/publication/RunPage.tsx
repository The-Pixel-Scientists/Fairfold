// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  asProblem,
  Button,
  buttonClassName,
  Dialog,
  Notice,
  PageHeader,
  SummaryList,
  Tag,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import type { PublicationRun, PublicationState } from '../../contracts/index.ts';
import { loadPublicationRun, markSubmitted } from '../api.ts';
import { formatDate, publicationKindLabels, publicationStateLabels } from '../format.ts';
import { downloadPath, insightPath } from '../paths.ts';
import { LinkButton, useWho } from '../parts.tsx';
import { useStepUp } from '../useStepUp.tsx';
import { period, stateWords } from './runWords.ts';

const UNEXPECTED = 'Something went wrong. Try again.';

/** How often a run that is still preparing is read again. */
const POLL_MS = 10_000;

const tones: Record<PublicationState, TagTone> = {
  preparing: 'info',
  prepared: 'success',
  failed: 'danger',
  submitted: 'neutral',
};

/** Reads the run again until it leaves `preparing`, and says once, politely, when it does. */
function useRun(initial: PublicationRun) {
  const [run, setRun] = useState(initial);
  const [announcement, setAnnouncement] = useState('');
  const [checkFailed, setCheckFailed] = useState(false);
  const checking = useRef(false);

  async function check() {
    if (checking.current) return;
    checking.current = true;
    try {
      const next = await loadPublicationRun(run.id);
      setCheckFailed(false);
      setRun(next);
      if (next.state !== 'preparing') {
        setAnnouncement(`The run is now: ${publicationStateLabels[next.state]}.`);
      }
    } catch {
      setCheckFailed(true);
    } finally {
      checking.current = false;
    }
  }

  const preparing = run.state === 'preparing';
  useEffect(() => {
    if (!preparing) return undefined;
    const timer = setInterval(() => {
      void check();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
    // check() reads the run's id, which does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparing]);

  return { run, setRun, announcement, checkFailed, check };
}

function Content({ initial }: { initial: PublicationRun }) {
  const { run, setRun, announcement, checkFailed, check } = useRun(initial);
  const who = useWho();
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const draft = run.kind !== 'three_sixty_giving';

  async function submit() {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    try {
      const done = await stepUp.run(() => markSubmitted(run.id));
      if (done !== null) {
        setRun(done);
        setConfirming(false);
      }
    } catch (failure) {
      setError(asProblem(failure)?.detail ?? UNEXPECTED);
    } finally {
      sending.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title={publicationKindLabels[run.kind]}
        breadcrumbs={[
          { label: 'Publication runs', to: insightPath('publication') },
          { label: publicationKindLabels[run.kind] },
        ]}
        eyebrow={<Tag tone={tones[run.state]}>{stateWords(run, who)}</Tag>}
        actions={
          <>
            {run.outputFileId !== null &&
              (run.state === 'prepared' || run.state === 'submitted') && (
                <a href={downloadPath(run.id)} className={buttonClassName()}>
                  Download file
                </a>
              )}
            {run.state === 'prepared' && (
              <Button
                variant="primary"
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                Mark as submitted
              </Button>
            )}
          </>
        }
      />
      <div role="status" className="text-body text-muted">
        {announcement}
      </div>
      {run.state === 'preparing' && (
        <Notice
          tone="info"
          title="Preparing"
          action={
            <Button
              onClick={() => {
                void check();
              }}
            >
              Check again
            </Button>
          }
        >
          This can take a few minutes. The page checks for you.
          {checkFailed && ' The last check did not get an answer.'}
        </Notice>
      )}
      {run.state === 'failed' && (
        <Notice
          tone="danger"
          title="This run could not be prepared"
          action={<LinkButton to={insightPath('publication-new')}>Prepare a run</LinkButton>}
        >
          Nothing was made. Prepare a run for the same period again. If it fails again, ask your
          administrator.
        </Notice>
      )}
      {draft && run.state !== 'failed' && (
        <Notice tone="warning" title="This is a draft">
          A named person at your funder must check it before it is used.
        </Notice>
      )}
      <SummaryList
        items={[
          { term: 'Kind', value: publicationKindLabels[run.kind] },
          { term: 'Period', value: period(run) },
          { term: 'State', value: stateWords(run, who) },
          { term: 'Prepared by', value: who(run.preparedByMembershipId) },
          { term: 'Prepared on', value: formatDate(run.createdAt) },
        ]}
      />
      <Dialog
        open={confirming && !stepUp.asking}
        onOpenChange={setConfirming}
        title="Record that you submitted this?"
        description="The software has not sent anything. Choose this only once you have submitted it yourself, outside the software. It records your name and the time."
        actions={
          <>
            <Button
              data-autofocus
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void submit();
              }}
            >
              Record that I submitted this
            </Button>
          </>
        }
      >
        {error !== null && (
          <p role="alert" className="text-body font-medium text-danger">
            {error}
          </p>
        )}
      </Dialog>
      {stepUp.dialog}
    </div>
  );
}

export default function RunPage({ runId }: { runId: string }) {
  const { state, retry } = useLoad(loadPublicationRun, runId);
  return (
    <WhenLoaded state={state} label="Loading the run" retry={retry}>
      {(run) => <Content key={run.id} initial={run} />}
    </WhenLoaded>
  );
}
