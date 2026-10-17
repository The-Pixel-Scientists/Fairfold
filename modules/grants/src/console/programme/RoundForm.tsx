// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  CurrencyInput,
  DateInput,
  ErrorSummary,
  FormField,
  Input,
  RadioGroup,
  useLeaveGuard,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import { createRound, latePolicies, updateRound } from '../../contracts/index.ts';
import type { LatePolicy, Programme, Round } from '../../contracts/index.ts';
import { FormFooter } from './FormFooter.tsx';
import { programmePath, roundPath } from './paths.ts';
import { naming, topField } from './problems.ts';
import { roundBody, roundDraft } from './roundDraft.ts';
import type { Moment, RoundDraft } from './roundDraft.ts';

const FIELDS = [
  'title',
  'opensAt',
  'opensAtTime',
  'closesAt',
  'closesAtTime',
  'budget',
  'awardMinimum',
  'awardMaximum',
  'latePolicy',
] as const;

const latePolicyOptions = (Object.keys(latePolicies) as LatePolicy[]).map((value) => ({
  value,
  label: latePolicies[value].label,
  hint: latePolicies[value].hint,
}));

const same = (a: RoundDraft, b: RoundDraft) => JSON.stringify(a) === JSON.stringify(b);

interface MomentFieldsProps {
  /** `opensAt` or `closesAt`: the id of the date's first box, and the start of the time's id. */
  id: 'opensAt' | 'closesAt';
  word: 'Opening' | 'Closing';
  value: Moment;
  onChange: (value: Moment) => void;
  dateError: string | undefined;
  timeError: string | undefined;
  /** Says which time zone the time is in. */
  zone: string;
}

/** A date in three boxes and a time. */
function MomentFields({
  id,
  word,
  value,
  onChange,
  dateError,
  timeError,
  zone,
}: MomentFieldsProps) {
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <DateInput
        id={id}
        legend={`${word} date`}
        value={value.date}
        error={dateError}
        onChange={(date) => {
          onChange({ ...value, date });
        }}
      />
      <FormField id={`${id}Time`} label={`${word} time`} hint={zone} error={timeError}>
        <Input
          type="time"
          value={value.time}
          className="w-40"
          onChange={(event) => {
            onChange({ ...value, time: event.currentTarget.value });
          }}
        />
      </FormField>
    </div>
  );
}

/**
 * Adds a round to a programme or, given a round, changes it. A new round
 * opens its own page once it is added; a changed one stays here, says it is
 * saved and is passed to `onSaved`.
 */
export function RoundForm({
  programme,
  round,
  onSaved,
}: {
  programme: Programme;
  round?: Round;
  onSaved?: (round: Round) => void;
}) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(round);
  const [initial, setInitial] = useState(() => roundDraft(round));
  const [draft, setDraft] = useState(initial);
  const [done, setDone] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useLeaveGuard(!same(draft, initial) && createdId === null);

  // Leave once the guard has gone: it goes when the page draws again without it.
  useEffect(() => {
    if (createdId !== null) navigate(roundPath(createdId));
  }, [createdId, navigate]);

  const form = useSubmit(
    FIELDS,
    naming(topField, async () => {
      const body = roundBody(draft);
      if (saved === undefined) {
        setCreatedId((await call(createRound, { params: { programmeId: programme.id }, body })).id);
        return;
      }
      const result = await call(updateRound, { params: { roundId: saved.id }, body });
      const next = roundDraft(result);
      setSaved(result);
      setInitial(next);
      setDraft(next);
      setDone(true);
      onSaved?.(result);
    }),
  );

  function edit(change: Partial<RoundDraft>) {
    setDone(false);
    setDraft((current) => ({ ...current, ...change }));
  }

  const zone =
    saved === undefined
      ? "In your funder's time zone, which the round shows once it is added"
      : `In the ${saved.timeZone} time zone`;

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-3xl flex-col gap-5">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField
        id="title"
        label="Title"
        hint="Applicants see this name, for example Spring 2027."
        error={form.errorFor('title')}
      >
        <Input
          value={draft.title}
          autoComplete="off"
          onChange={(event) => {
            edit({ title: event.currentTarget.value });
          }}
        />
      </FormField>
      <MomentFields
        id="opensAt"
        word="Opening"
        value={draft.opens}
        onChange={(opens) => {
          edit({ opens });
        }}
        dateError={form.errorFor('opensAt')}
        timeError={form.errorFor('opensAtTime')}
        zone={zone}
      />
      <MomentFields
        id="closesAt"
        word="Closing"
        value={draft.closes}
        onChange={(closes) => {
          edit({ closes });
        }}
        dateError={form.errorFor('closesAt')}
        timeError={form.errorFor('closesAtTime')}
        zone={zone}
      />
      <FormField
        id="budget"
        label="Budget"
        hint="The most you plan to award in this round, in pounds."
        error={form.errorFor('budget')}
      >
        <CurrencyInput
          value={draft.budget}
          onChange={(budget) => {
            edit({ budget });
          }}
        />
      </FormField>
      <div className="flex flex-wrap gap-x-8 gap-y-5">
        <FormField
          id="awardMinimum"
          label="Smallest award"
          hint="In pounds."
          error={form.errorFor('awardMinimum')}
        >
          <CurrencyInput
            value={draft.awardMinimum}
            onChange={(awardMinimum) => {
              edit({ awardMinimum });
            }}
          />
        </FormField>
        <FormField
          id="awardMaximum"
          label="Largest award"
          hint="In pounds."
          error={form.errorFor('awardMaximum')}
        >
          <CurrencyInput
            value={draft.awardMaximum}
            onChange={(awardMaximum) => {
              edit({ awardMaximum });
            }}
          />
        </FormField>
      </div>
      <RadioGroup
        id="latePolicy"
        name="latePolicy"
        legend="Late applications"
        hint="What happens to an application submitted after the closing time."
        value={draft.latePolicy}
        options={latePolicyOptions}
        error={form.errorFor('latePolicy')}
        onValueChange={(latePolicy) => {
          edit({ latePolicy: latePolicy as LatePolicy });
        }}
      />
      <FormFooter
        save={saved === undefined ? 'Add round' : 'Save round'}
        pending={form.pending}
        back={saved === undefined ? 'Cancel' : 'Back to round'}
        backTo={saved === undefined ? programmePath(programme.id) : roundPath(saved.id)}
        saved={done && 'Round saved.'}
      />
    </form>
  );
}
