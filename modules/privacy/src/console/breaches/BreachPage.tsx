// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Button, Notice, PageHeader, Panel, SummaryList } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { getBreach } from '../../contracts/index.ts';
import type { Breach } from '../../contracts/index.ts';
import { useNow, useRead, useZone } from '../hooks.ts';
import { Reading } from '../parts.tsx';
import { viewPath } from '../paths.ts';
import {
  breachClockText,
  categoryLabel,
  deadlinePassed,
  formatMoment,
  lateWords,
  methodWords,
  riskWords,
} from '../words.ts';
import { AssessDialog } from './AssessDialog.tsx';
import { IcoDialog, SubjectsDialog } from './NotifyDialogs.tsx';

const loadBreach = (breachId: string) => call(getBreach, { params: { breachId } });

type Dialog = 'assess' | 'ico' | 'subjects';

function BreachDetail({
  breach,
  onChange,
}: {
  breach: Breach;
  onChange: (breach: Breach) => void;
}) {
  const zone = useZone();
  const now = useNow();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => {
    setDialog(null);
  };

  const { icoNotification, subjectNotification, assessments } = breach;
  const open = icoNotification === null;
  const passed = open && deadlinePassed(breach.becameAwareAt, now);
  const countdown = breachClockText(
    { becameAwareAt: breach.becameAwareAt, icoNotified: !open, late: breach.clock.late },
    now,
    zone,
  );

  // One polite announcement when the deadline passes, and none for each tick of the countdown.
  const wasPassed = useRef(passed);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (passed && !wasPassed.current)
      setAnnouncement('The 72-hour deadline to tell the ICO has passed.');
    wasPassed.current = passed;
  }, [passed]);

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[
          { label: 'Personal data breaches', to: viewPath('breaches') },
          { label: `Breach of ${formatMoment(breach.becameAwareAt, zone)}` },
        ]}
        title="Breach"
        description={`You became aware at ${formatMoment(breach.becameAwareAt, zone)}.`}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setDialog('assess');
            }}
          >
            Add assessment
          </Button>
        }
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <Notice
        tone={passed ? 'danger' : open ? 'warning' : 'success'}
        title={open ? '72-hour clock' : 'The ICO has been told'}
      >
        <p>{countdown}</p>
      </Notice>
      <Panel title="What happened">
        <SummaryList
          items={[
            { term: 'Found', value: formatMoment(breach.discoveredAt, zone) },
            {
              term: 'Description',
              value: <span className="whitespace-pre-wrap">{breach.description}</span>,
            },
            {
              term: 'Data involved',
              value: (
                <ul>
                  {breach.dataCategories.map((category) => (
                    <li key={category}>{categoryLabel(category)}</li>
                  ))}
                </ul>
              ),
            },
            { term: 'People affected', value: breach.approximateSubjects ?? 'Not known' },
            { term: 'Records affected', value: breach.approximateRecords ?? 'Not known' },
            {
              term: 'Likely consequences',
              value: (
                <span className="whitespace-pre-wrap">
                  {breach.likelyConsequences || 'None recorded'}
                </span>
              ),
            },
            {
              term: 'What has been done',
              value: (
                <span className="whitespace-pre-wrap">
                  {breach.measuresTaken || 'None recorded'}
                </span>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title="Assessments">
        {assessments.length === 0 ? (
          <p className="text-body text-muted">
            Not assessed yet. Add an assessment to record the risk to people and whom to tell. Each
            one is kept; none is changed or removed.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {[...assessments].reverse().map((assessment, index) => (
              <li
                key={assessment.id}
                className="flex flex-col gap-0.5 border-b border-divider pb-3 last:border-0 last:pb-0"
              >
                <span className="font-medium">
                  {formatMoment(assessment.assessedAt, zone)}: {riskWords[assessment.riskLevel]}
                  {index === 0 ? ' (current)' : ''}
                </span>
                <span>
                  {assessment.notifyIco ? 'Tell the ICO' : 'No need to tell the ICO'}.{' '}
                  {assessment.notifySubjects
                    ? 'Tell the people affected'
                    : 'No need to tell the people affected'}
                  .
                </span>
                {assessment.rationale !== '' && (
                  <span className="whitespace-pre-wrap text-muted">{assessment.rationale}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel
        title="Who has been told"
        actions={
          <>
            {open && (
              <Button
                onClick={() => {
                  setDialog('ico');
                }}
              >
                Record that we told the ICO
              </Button>
            )}
            {subjectNotification === null && (
              <Button
                onClick={() => {
                  setDialog('subjects');
                }}
              >
                Record that we told the people affected
              </Button>
            )}
          </>
        }
      >
        <SummaryList
          items={[
            {
              term: 'The ICO',
              value:
                icoNotification === null
                  ? 'Not recorded'
                  : `Told at ${formatMoment(icoNotification.notifiedAt, zone)}, reference ${icoNotification.reference}${
                      icoNotification.lateReason === null
                        ? ''
                        : `. Late: ${lateWords[icoNotification.lateReason].toLowerCase()}`
                    }`,
            },
            {
              term: 'The people affected',
              value:
                subjectNotification === null
                  ? 'Not recorded'
                  : `Told at ${formatMoment(subjectNotification.notifiedAt, zone)} by ${methodWords[subjectNotification.method].toLowerCase()}`,
            },
          ]}
        />
      </Panel>
      <AssessDialog
        open={dialog === 'assess'}
        onClose={close}
        breachId={breach.id}
        onRecorded={(assessment) => {
          onChange({ ...breach, assessments: [...breach.assessments, assessment] });
        }}
      />
      <IcoDialog open={dialog === 'ico'} onClose={close} breach={breach} onChange={onChange} />
      <SubjectsDialog
        open={dialog === 'subjects'}
        onClose={close}
        breach={breach}
        onChange={onChange}
      />
    </div>
  );
}

export function BreachPage({ breachId }: { breachId: string }) {
  const { state, reload, set } = useRead(loadBreach, breachId);
  return (
    <Reading state={state} label="Loading breach" retry={reload}>
      {(breach) => <BreachDetail breach={breach} onChange={set} />}
    </Reading>
  );
}
