// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which published form version a round uses for equality monitoring, apart
// from the application form. Only versions that pass the monitoring check
// are offered. This screen reads and sends the choice and nothing else: no
// answer, and no sign of whether anyone has answered, reaches the console.

import { call } from '@pixel-scientists/domain/api';
import { Button, EmptyState, FormField, Select, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import {
  getFormVersion,
  getRoundMonitoringForm,
  listFormVersions,
  monitoringDefinitionProblems,
  setRoundMonitoringForm,
} from '../../contracts/index.ts';
import { problemLines } from '../assessment/problems.ts';
import { formatMoment } from './format.ts';

async function loadChoice(roundId: string) {
  const params = { roundId };
  const [{ formVersionId }, { versions }] = await Promise.all([
    call(getRoundMonitoringForm, { params }),
    call(listFormVersions, { params }),
  ]);
  const published = await Promise.all(
    versions
      .filter(({ status }) => status === 'published')
      .map(({ id }) => call(getFormVersion, { params: { formVersionId: id } })),
  );
  const offered = published.filter(
    ({ definition }) =>
      definition !== null && monitoringDefinitionProblems(definition).length === 0,
  );
  return { chosen: formVersionId, offered };
}

type Choice = Awaited<ReturnType<typeof loadChoice>>;

function ChoiceForm({
  roundId,
  initial,
  timeZone,
}: {
  roundId: string;
  initial: Choice;
  timeZone: string;
}) {
  const [chosen, setChosen] = useState(initial.chosen ?? '');
  const [saved, setSaved] = useState(initial.chosen ?? '');
  const [failure, setFailure] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure([]);
    setNotice('');
    try {
      const result = await call(setRoundMonitoringForm, {
        params: { roundId },
        body: { formVersionId: chosen === '' ? null : chosen },
      });
      setSaved(result.formVersionId ?? '');
      setNotice(
        result.formVersionId === null
          ? 'This round has no equality monitoring form.'
          : 'Equality monitoring form saved.',
      );
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex max-w-prose flex-col gap-4"
    >
      {failure.length > 0 && (
        <p role="alert" className="font-medium text-danger">
          {failure.join(' ')}
        </p>
      )}
      <FormField
        id="monitoringFormVersionId"
        label="Equality monitoring form"
        hint="Applicants are invited to answer after they submit. Nobody has to."
      >
        <Select
          value={chosen}
          onChange={(event) => {
            setChosen(event.currentTarget.value);
          }}
        >
          <option value="">No equality monitoring form</option>
          {initial.offered.map((version) => (
            <option key={version.id} value={version.id}>
              Version {version.version}, published{' '}
              {version.publishedAt === null ? '' : formatMoment(version.publishedAt, timeZone)}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          aria-disabled={pending || chosen === saved || undefined}
        >
          Save equality monitoring form
        </Button>
        <p role="status" className="text-body text-ink empty:hidden">
          {notice}
        </p>
      </div>
    </form>
  );
}

/** Choosing the round's equality monitoring form, and what staff and reviewers will and will not see of it. */
export function MonitoringChoice({ roundId, timeZone }: { roundId: string; timeZone: string }) {
  const { state, retry } = useLoad(loadChoice, roundId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Equality monitoring</h2>
        <p className="text-body text-muted">
          Staff and reviewers never see individual answers. Reports show only totals.
        </p>
      </div>
      <WhenLoaded state={state} label="Loading equality monitoring" retry={retry}>
        {(choice) =>
          choice.offered.length === 0 && choice.chosen === null ? (
            <EmptyState title="No equality monitoring form to choose" headingLevel="h3">
              <p>
                Publish a form that uses only the equality monitoring questions. Each question is
                optional, is seen only in totals, and has a &quot;Prefer not to say&quot; choice. It
                then appears here.
              </p>
            </EmptyState>
          ) : (
            <ChoiceForm roundId={roundId} initial={choice} timeZone={timeZone} />
          )
        }
      </WhenLoaded>
    </div>
  );
}
