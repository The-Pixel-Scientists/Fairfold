// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  Button,
  buttonClassName,
  CheckboxGroup,
  EmptyState,
  FormField,
  Link,
  Notice,
  PageHeader,
  Panel,
  Select,
  Stats,
  SummaryList,
  Tag,
  useCan,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { outcomeIds, outcomes } from '../../contracts/index.ts';
import type { DecisionList } from '../../contracts/index.ts';
import { useParam } from '../assessment/Page.tsx';
import { problemLines } from '../assessment/problems.ts';
import { PROGRAMMES_PATH, programmePath, roundPath } from '../programme/paths.ts';
import { EmailPreview } from './EmailDialog.tsx';
import { Failure } from './Failure.tsx';
import { loadDecisionPage, loadDecisions, releaseChecked } from './loaders.ts';
import { Gate } from './Page.tsx';
import { decisionsPath } from './paths.ts';
import { budgetWords, countOf, deliveryWords, overBudget, tally } from './totals.ts';
import { UnsentEmails } from './UnsentEmails.tsx';
import { useStepUp } from './useStepUp.tsx';

const CONFIRM_ID = 'confirm-release';

/** What the page tells the person once something has gone. */
interface Done {
  title: string;
  body: string;
}

function Review({
  roundId,
  list,
  onReleased,
}: {
  roundId: string;
  list: DecisionList;
  onReleased: (done: Done, unsent: number) => void;
}) {
  const stepUp = useStepUp();
  const [confirmed, setConfirmed] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [failure, setFailure] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [choice, setChoice] = useState('');

  const waiting = list.submissions.filter(
    (row) => row.decision !== null && row.decision.releasedAt === null,
  );
  const counts = tally(waiting);
  const undecided = tally(list.submissions).undecided;
  const over = overBudget(list);
  const examples = outcomeIds.flatMap((outcome) => {
    const row = waiting.find((item) => item.decision?.outcome === outcome);
    return row
      ? [{ id: row.submissionId, label: `${outcomes[outcome]}: ${row.organisation.name}` }]
      : [];
  });
  const previewId = examples.find(({ id }) => id === choice)?.id ?? examples[0]?.id ?? '';
  const awards = waiting.reduce((sum, row) => sum + (row.decision?.amount?.amountMinor ?? 0), 0);

  async function release() {
    if (pending) return;
    if (!confirmed) {
      setUnconfirmed(true);
      document.getElementById(CONFIRM_ID)?.focus();
      return;
    }
    if (!(await stepUp.ask())) return;
    setPending(true);
    setFailure([]);
    try {
      const result = await releaseChecked(
        roundId,
        waiting.map((row) => row.submissionId),
      );
      onReleased(
        {
          title: 'Decisions released',
          body: `${countOf(result.released, 'decision')} released. ${deliveryWords(result)}`,
        },
        result.pending + result.failed,
      );
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="happens" className="flex flex-col gap-3">
            <h2 id="happens" className="text-lg font-semibold tracking-tight text-ink">
              What will happen
            </h2>
            <Stats
              label="Decisions to release"
              items={[
                {
                  label: 'Awarded',
                  value: formatMoney({ amountMinor: awards, currency: list.awarded.currency }),
                  detail: `to ${countOf(counts.accepted, 'applicant')}`,
                },
                { label: 'Waitlisted', value: counts.waitlisted, detail: 'told they are waiting' },
                { label: 'Declined', value: counts.declined, detail: 'told they were not funded' },
                {
                  label: 'Emails',
                  value: waiting.length,
                  detail: 'sent now, one to each applicant',
                },
              ]}
            />
          </section>
          <section aria-labelledby="checks" className="flex flex-col gap-3">
            <h2 id="checks" className="text-lg font-semibold tracking-tight text-ink">
              Checks
            </h2>
            <ul className="flex flex-col divide-y divide-divider text-body">
              <li className="flex items-start gap-3 py-2 first:pt-0">
                <Tag tone={over > 0 ? 'warning' : 'success'}>
                  {over > 0 ? 'Check' : 'Within budget'}
                </Tag>
                <span>All awards: {budgetWords(list)}.</span>
              </li>
              <li className="flex items-start gap-3 py-2 last:pb-0">
                <Tag tone={undecided > 0 ? 'warning' : 'success'}>
                  {undecided > 0 ? 'Check' : 'All decided'}
                </Tag>
                <span>
                  {undecided > 0
                    ? `${countOf(undecided, 'submission')} with no decision. Their applicants are told nothing now.`
                    : 'Every submission has a decision.'}
                </span>
              </li>
            </ul>
          </section>
          <section aria-labelledby="sent" className="flex flex-col gap-3">
            <h2 id="sent" className="text-lg font-semibold tracking-tight text-ink">
              How it is sent
            </h2>
            <SummaryList
              items={[
                { term: 'Sent', value: 'Straight after you confirm' },
                { term: 'Applicants see', value: 'Their outcome when they sign in' },
                {
                  term: 'Afterwards',
                  value:
                    'A released decision cannot be changed. Any email that does not go can be sent again.',
                },
              ]}
            />
          </section>
        </div>
        <Panel title="Email preview" className="self-start">
          <FormField
            label="Preview the email for"
            hint="Each applicant gets the email for their decision."
          >
            <Select
              value={previewId}
              onChange={(event) => {
                setChoice(event.currentTarget.value);
              }}
            >
              {examples.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </FormField>
          {previewId !== '' && <EmailPreview key={previewId} submissionId={previewId} />}
        </Panel>
      </div>
      <Failure lines={failure} />
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t border-divider pt-6">
        <CheckboxGroup
          className="max-w-prose"
          legend="Confirm the release"
          id={CONFIRM_ID}
          name="confirm"
          values={confirmed ? ['confirmed'] : []}
          onValuesChange={(values) => {
            setConfirmed(values.includes('confirmed'));
            setUnconfirmed(false);
          }}
          hint="You will be asked to confirm it is you."
          error={
            unconfirmed && !confirmed
              ? 'Tick the box to confirm you have checked the summary and the email.'
              : undefined
          }
          options={[
            {
              value: 'confirmed',
              label: `I have checked the summary and the email. I understand that all ${countOf(waiting.length, 'applicant')} are told as soon as I confirm.`,
            },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Link to={decisionsPath(roundId)} className={buttonClassName('quiet')}>
            Back to decisions
          </Link>
          <Button
            variant="primary"
            aria-disabled={pending || undefined}
            onClick={() => {
              void release();
            }}
          >
            Release decisions
          </Button>
        </div>
      </div>
      {stepUp.dialog}
    </>
  );
}

function Release({ roundId, initial }: { roundId: string; initial: DecisionList }) {
  const [list, setList] = useState(initial);
  const [done, setDone] = useState<Done | null>(null);
  const [released, setReleased] = useState(false);
  const [unsent, setUnsent] = useState(initial.unsentEmails);
  const status = useRef<HTMLDivElement>(null);
  const waiting = tally(list.submissions).unreleased;

  useEffect(() => {
    if (done !== null) status.current?.focus();
  }, [done]);

  async function finish(next: Done, left: number, justReleased: boolean) {
    setDone(next);
    setUnsent(left);
    if (!justReleased) return;
    setReleased(true);
    try {
      setList(await loadDecisions(roundId));
    } catch {
      // The release is done; the list on the decisions page will be read again.
    }
  }

  return (
    <>
      <div ref={status} role="status" tabIndex={-1} className="empty:hidden">
        {done && (
          <Notice
            tone="success"
            title={done.title}
            action={
              <Link to={decisionsPath(roundId)} className={buttonClassName()}>
                Back to decisions
              </Link>
            }
          >
            {done.body}
          </Notice>
        )}
      </div>
      <UnsentEmails
        roundId={roundId}
        count={unsent}
        onSent={(delivery) => {
          void finish(
            { title: 'Emails sent', body: deliveryWords(delivery) },
            delivery.pending + delivery.failed,
            false,
          );
        }}
      />
      {waiting > 0 && !released ? (
        <Review
          roundId={roundId}
          list={list}
          onReleased={(next, left) => {
            void finish(next, left, true);
          }}
        />
      ) : (
        !released && (
          <EmptyState
            title="No decisions to release"
            action={
              <Link to={decisionsPath(roundId)} className={buttonClassName()}>
                Go to decisions
              </Link>
            }
          >
            <p>
              Every recorded decision has been released. Record a decision for a submission first,
              then come back to release it.
            </p>
          </EmptyState>
        )
      )}
    </>
  );
}

function RoundRelease({ roundId }: { roundId: string }) {
  const canRecord = useCan('grants.decisions.record');
  const { state, retry } = useLoad(loadDecisionPage, roundId);
  const loaded = state.status === 'ready' ? state.value : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          loaded
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                ...(loaded.programme
                  ? [{ label: loaded.programme.title, to: programmePath(loaded.programme.id) }]
                  : []),
                { label: loaded.list.round.title, to: roundPath(roundId) },
                ...(canRecord ? [{ label: 'Decisions', to: decisionsPath(roundId) }] : []),
                { label: 'Release decisions' },
              ]
            : undefined
        }
        title="Release decisions"
        description="Check what each applicant will be told. Every decision stays private to staff until you confirm."
      />
      <WhenLoaded state={state} label="Loading decisions" retry={retry}>
        {({ list }) => <Release key={roundId} roundId={roundId} initial={list} />}
      </WhenLoaded>
    </>
  );
}

/** Tells every applicant their recorded outcome in one step, after a summary, a look at the email and a check that it is you. */
export default function ReleasePage() {
  const roundId = useParam('roundId');
  return (
    <Gate
      permission="grants.decisions.release"
      heading="Release decisions"
      title="You cannot release decisions"
    >
      <RoundRelease roundId={roundId} />
    </Gate>
  );
}
