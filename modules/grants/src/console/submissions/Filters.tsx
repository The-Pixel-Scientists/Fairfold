// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, FormField, Select, useLoad } from '@pixel-scientists/ui';
import type { ChangeEvent } from 'react';

import { eligibilityOutcomes, submissionStatuses } from '../../contracts/index.ts';
import type { ProgrammeList, SubmissionQuery } from '../../contracts/index.ts';
import { loadStages } from './loaders.ts';
import { isFiltered } from './query.ts';
import type { FilterChange } from './query.ts';

interface FiltersProps {
  query: SubmissionQuery;
  /** Null while they load, when the fields are there but cannot be changed yet, so the page does not move when they arrive. */
  programmes: ProgrammeList['programmes'] | null;
  onChange: (change: FilterChange) => void;
  onClear: () => void;
}

const noChange = () => undefined;

/** A change from a select: the chosen value, or nothing for "Any". */
const valueOf = (event: ChangeEvent<HTMLSelectElement>) => event.currentTarget.value || undefined;

interface StageFieldProps {
  value: string | undefined;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

/** The stage select: disabled, with the reason in its only option, while there are no stages to choose. */
function StageField({
  stages,
  note,
  value,
  onChange,
}: StageFieldProps & { stages: readonly { id: string; name: string }[]; note: string | null }) {
  return (
    <FormField label="Stage">
      <Select value={value ?? ''} disabled={note !== null} onChange={onChange}>
        <option value="">{note ?? 'Any'}</option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

function RoundStages({ roundId, ...field }: StageFieldProps & { roundId: string }) {
  const { state } = useLoad(loadStages, roundId);
  const note =
    state.status === 'failed'
      ? 'Stages did not load'
      : state.status === 'loading'
        ? 'Loading stages'
        : null;
  return (
    <StageField
      stages={state.status === 'ready' ? state.value.stages : []}
      note={note}
      {...field}
    />
  );
}

/** The list's filters. Each change goes in the address, so Back brings the earlier filters back. */
export function Filters({ query, programmes, onChange, onClear }: FiltersProps) {
  const loaded = programmes ?? [];
  const rounds = loaded.filter(
    ({ id }) => query.programmeId === undefined || id === query.programmeId,
  );
  return (
    <form
      role="search"
      aria-label="Filter submissions"
      onSubmit={(event) => {
        event.preventDefault();
      }}
      className="grid items-end gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]"
    >
      {(programmes === null || programmes.length > 0) && (
        <>
          <FormField label="Programme">
            <Select
              disabled={programmes === null}
              value={query.programmeId ?? ''}
              onChange={(event) => {
                onChange({ programmeId: valueOf(event) });
              }}
            >
              <option value="">Any</option>
              {loaded.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Round">
            <Select
              disabled={programmes === null}
              value={query.roundId ?? ''}
              onChange={(event) => {
                onChange({ roundId: valueOf(event) });
              }}
            >
              <option value="">Any</option>
              {rounds.map((programme) => (
                <optgroup key={programme.id} label={programme.title}>
                  {programme.rounds.map((round) => (
                    <option key={round.id} value={round.id}>
                      {round.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </FormField>
          {query.roundId === undefined ? (
            <StageField stages={[]} note="Pick a round" value={undefined} onChange={noChange} />
          ) : (
            <RoundStages
              key={query.roundId}
              roundId={query.roundId}
              value={query.stageId}
              onChange={(event) => {
                onChange({ stageId: valueOf(event) });
              }}
            />
          )}
        </>
      )}
      <FormField label="Status">
        <Select
          value={query.status ?? ''}
          onChange={(event) => {
            onChange({ status: valueOf(event) });
          }}
        >
          <option value="">Any</option>
          {Object.entries(submissionStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Eligibility">
        <Select
          value={query.eligibility ?? ''}
          onChange={(event) => {
            onChange({ eligibility: valueOf(event) });
          }}
        >
          <option value="">Any</option>
          {Object.entries(eligibilityOutcomes).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Late">
        <Select
          value={query.late === undefined ? '' : String(query.late)}
          onChange={(event) => {
            onChange({ late: valueOf(event) });
          }}
        >
          <option value="">Any</option>
          <option value="true">Late only</option>
          <option value="false">On time only</option>
        </Select>
      </FormField>
      {isFiltered(query) && (
        <Button variant="quiet" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </form>
  );
}
