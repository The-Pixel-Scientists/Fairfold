// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  Button,
  Checkbox,
  DateInput,
  ErrorSummary,
  FormField,
  Input,
  NotFoundPage,
  Notice,
  PageHeader,
  Panel,
  RadioGroup,
  Textarea,
  WhenLoaded,
  Link,
  useLeaveGuard,
  useLoad,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { assureMessages, visitTypes } from '../../contracts/index.ts';
import type { Visit } from '../../contracts/index.ts';
import { Gate, useParam } from '../Gate.tsx';
import { changeVisit, loadVisit, recordVisit } from '../loaders.ts';
import { VISITS_PATH, organisationLookupsPath, visitPath } from '../paths.ts';
import { visitTypeWords } from '../words.ts';
import { RecordPicker } from './RecordPicker.tsx';
import type { Found } from './RecordPicker.tsx';

const FINDINGS_LIMIT = 10_000;
const ACTION_LIMIT = 300;
const FIELDS = ['organisationId', 'visitedOn', 'type', 'attendeePersonIds', 'findings'] as const;

interface FollowUp {
  action: string;
  dueOn: string | null;
  done: boolean;
}

const fieldsFor = (followUps: readonly FollowUp[]) => [
  ...FIELDS,
  ...followUps.map((_, index) => `followUps.${String(index)}.action`),
];

function Chosen({ found, empty }: { found: Found | null; empty: string }) {
  return <p className="text-body">{found === null ? empty : found.label}</p>;
}

function Form({ visit }: { visit: Visit | null }) {
  const [organisation, setOrganisation] = useState<Found | null>(null);
  const [application, setApplication] = useState<Found | null>(null);
  const [visitedOn, setVisitedOn] = useState<string | null>(visit?.visitedOn ?? null);
  const [type, setType] = useState<Visit['type'] | ''>(visit?.type ?? '');
  const [attendees, setAttendees] = useState<readonly Found[]>(
    (visit?.attendeePersonIds ?? []).map((id, index) => ({
      id,
      label: `Recorded attendee ${String(index + 1)}`,
    })),
  );
  const [findings, setFindings] = useState(visit?.findings ?? '');
  const [followUps, setFollowUps] = useState<readonly FollowUp[]>(visit?.followUps ?? []);
  const [done, setDone] = useState<Visit | null>(null);
  const retryKey = useRef<string | undefined>(undefined);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const [said, setSaid] = useState('');
  const dirty =
    done === null && (visit === null ? findings !== '' || organisation !== null : false);

  useLeaveGuard(dirty);
  useEffect(() => {
    if (done !== null) confirmation.current?.focus();
  }, [done]);

  const form = useSubmit(fieldsFor(followUps), async () => {
    if (type === '') {
      throw new ProblemError(400, 'Check the visit details and try again.', {
        errors: [{ field: 'body.type', message: assureMessages.visitType }],
      });
    }
    const shape = {
      visitedOn: visitedOn ?? '',
      type,
      attendeePersonIds: attendees.map(({ id }) => id),
      findings,
      followUps: followUps.map((entry) => ({ ...entry, action: entry.action.trim() })),
      evidence: [...(visit?.evidence ?? [])],
    };
    if (visit !== null) {
      setDone(await changeVisit(visit.id, shape));
      return;
    }
    try {
      const body = {
        organisationId: organisation?.id ?? '',
        applicationId: application?.id ?? null,
        ...shape,
      };
      setDone(await recordVisit(body, retryKey.current));
    } catch (error) {
      const sent = (error as { idempotencyKey?: string | null }).idempotencyKey;
      retryKey.current = typeof sent === 'string' ? sent : undefined;
      throw error;
    }
  });

  const setFollowUp = (index: number, next: FollowUp) => {
    retryKey.current = undefined;
    setFollowUps(followUps.map((entry, at) => (at === index ? next : entry)));
  };

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-stack">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      {done !== null && (
        <Notice tone="success" title="Saved">
          <h2 ref={confirmation} tabIndex={-1} className="font-semibold outline-offset-4">
            {visit === null ? 'Visit recorded' : 'Changes saved'}
          </h2>
          <p>
            <Link to={visitPath(done.id)}>Open the visit</Link>
          </p>
        </Notice>
      )}
      <Panel title="Visit">
        {visit === null ? (
          <>
            <div id="organisationId" tabIndex={-1} className="flex flex-col gap-2">
              <RecordPicker
                label="Organisation"
                hint="Search by name. Choose the organisation you visited."
                module="crm"
                kind="crm.organisation"
                onPick={setOrganisation}
              />
              <Chosen found={organisation} empty="No organisation chosen." />
              {form.errorFor('organisationId') !== undefined && (
                <p className="font-medium text-danger">{form.errorFor('organisationId')}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <RecordPicker
                label="Application"
                hint="Optional. Search by reference or name."
                module="grants"
                kind="grants.application"
                onPick={setApplication}
              />
              <Chosen found={application} empty="No application chosen." />
            </div>
          </>
        ) : (
          <p>
            <Link to={organisationLookupsPath(visit.organisationId)}>Registry details</Link> for the
            organisation visited.
          </p>
        )}
        <DateInput
          legend="Date of visit"
          id="visitedOn"
          value={visitedOn}
          onChange={setVisitedOn}
          error={form.errorFor('visitedOn')}
        />
        <RadioGroup
          legend="How the visit took place"
          name="type"
          id="type"
          value={type}
          onValueChange={(value) => {
            setType(visitTypes.find((known) => known === value) ?? '');
          }}
          options={visitTypes.map((value) => ({ value, label: visitTypeWords[value] }))}
          error={form.errorFor('type')}
        />
      </Panel>
      <Panel title="Attendees">
        <RecordPicker
          label="Add an attendee"
          hint="Search for a person by name. Choose from the results."
          module="crm"
          kind="crm.person"
          onPick={(person) => {
            if (!attendees.some(({ id }) => id === person.id)) setAttendees([...attendees, person]);
            setSaid(`${person.label} added.`);
          }}
        />
        <div id="attendeePersonIds" tabIndex={-1}>
          {form.errorFor('attendeePersonIds') !== undefined && (
            <p className="font-medium text-danger">{form.errorFor('attendeePersonIds')}</p>
          )}
          {attendees.length === 0 ? (
            <p className="text-muted">No attendees added.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {attendees.map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{person.label}</span>
                  <Button
                    onClick={() => {
                      setAttendees(attendees.filter(({ id }) => id !== person.id));
                      setSaid(`${person.label} removed.`);
                    }}
                  >
                    {`Remove ${person.label}`}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p role="status" className="sr-only">
          {said}
        </p>
      </Panel>
      <Panel title="Findings and follow-up">
        <FormField
          label="Findings"
          id="findings"
          hint={`${String(findings.length)} of ${String(FINDINGS_LIMIT)} characters. These may name people, so keep to what the visit needs.`}
          error={form.errorFor('findings')}
        >
          <Textarea
            rows={6}
            maxLength={FINDINGS_LIMIT}
            value={findings}
            onChange={(event) => {
              setFindings(event.target.value);
            }}
          />
        </FormField>
        {followUps.length > 0 && (
          <ul className="flex flex-col gap-3">
            {followUps.map((entry, index) => {
              const at = `followUps.${String(index)}.action`;
              return (
                <li key={at} className="flex flex-col gap-2 rounded-lg border border-divider p-3">
                  <FormField
                    label={`Follow-up ${String(index + 1)}`}
                    id={at}
                    hint={`${String(entry.action.length)} of ${String(ACTION_LIMIT)} characters.`}
                    error={form.errorFor(at)}
                  >
                    <Input
                      value={entry.action}
                      maxLength={ACTION_LIMIT}
                      onChange={(event) => {
                        setFollowUp(index, { ...entry, action: event.target.value });
                      }}
                    />
                  </FormField>
                  <Checkbox
                    label="Done"
                    checked={entry.done}
                    onCheckedChange={(checked) => {
                      setFollowUp(index, { ...entry, done: checked });
                    }}
                  />
                  <div>
                    <Button
                      onClick={() => {
                        setFollowUps(followUps.filter((_, position) => position !== index));
                      }}
                    >
                      {`Remove follow-up ${String(index + 1)}`}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div>
          <Button
            onClick={() => {
              setFollowUps([...followUps, { action: '', dueOn: null, done: false }]);
            }}
          >
            Add follow-up
          </Button>
        </div>
      </Panel>
      {visit !== null && visit.evidence.length > 0 && (
        <Panel title="Evidence">
          <p>{`${String(visit.evidence.length)} ${visit.evidence.length === 1 ? 'file is' : 'files are'} linked to this visit. Adding more files is not available yet.`}</p>
        </Panel>
      )}
      <div>
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          {visit === null ? 'Record visit' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function Edit() {
  const visitId = useParam('visitId');
  const { state, retry } = useLoad(loadVisit, visitId);
  return (
    <WhenLoaded state={state} label="Loading the visit" retry={retry}>
      {(visit) =>
        'state' in visit ? (
          <NotFoundPage />
        ) : (
          <>
            <PageHeader
              breadcrumbs={[{ label: 'Visits', to: VISITS_PATH }, { label: 'Visit' }]}
              title="Monitoring visit"
              description={`Recorded ${visit.recordedAt.slice(0, 10)}. Changes are saved under your name.`}
            />
            <Form visit={visit} />
          </>
        )
      }
    </WhenLoaded>
  );
}

export default function VisitFormPage() {
  const isNew = useParam('visitId') === '';
  return (
    <Gate permission="assure.visits.manage">
      {isNew ? (
        <>
          <PageHeader
            breadcrumbs={[{ label: 'Visits', to: VISITS_PATH }, { label: 'Record a visit' }]}
            title="Record a visit"
            description="What you saw, who was there and what happens next."
          />
          <Form visit={null} />
        </>
      ) : (
        <Edit />
      )}
    </Gate>
  );
}
