// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  Notice,
  Select,
  Textarea,
  useLeaveGuard,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import {
  createFramework,
  indicatorAggregations,
  indicatorDirections,
  indicatorUnits,
  MAX_INDICATORS,
  MAX_OUTCOMES,
  updateFramework,
} from '../contracts/index.ts';
import type {
  Framework,
  IndicatorAggregation,
  IndicatorDirection,
  IndicatorUnit,
} from '../contracts/index.ts';
import {
  blankIndicator,
  blankOutcome,
  boxFor,
  frameworkBody,
  frameworkBoxes,
  frameworkDraft,
} from './draft.ts';
import type { FrameworkDraft, IndicatorDraft, OutcomeDraft } from './draft.ts';
import { LinkButton } from './Page.tsx';
import { frameworkPath, IMPACT_PATH } from './paths.ts';
import { naming } from './problems.ts';
import { aggregationWords, directionWords, unitWords } from './words.ts';

type ErrorFor = (box: string) => string | undefined;

function IndicatorRow({
  indicator,
  label,
  onChange,
  onRemove,
  error,
}: {
  indicator: IndicatorDraft;
  label: string;
  onChange: (indicator: IndicatorDraft) => void;
  onRemove: () => void;
  error: ErrorFor;
}) {
  const box = (part: string) => `indicator-${indicator.id}-${part}`;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-divider p-3">
      <FormField id={box('name')} label={`${label} name`} error={error(box('name'))}>
        <Input
          value={indicator.name}
          autoComplete="off"
          onChange={(event) => {
            onChange({ ...indicator, name: event.currentTarget.value });
          }}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id={box('unit')} label={`${label} unit`} error={error(box('unit'))}>
          <Select
            value={indicator.unit}
            onChange={(event) => {
              onChange({ ...indicator, unit: event.currentTarget.value as IndicatorUnit });
            }}
          >
            {indicatorUnits.map((unit) => (
              <option key={unit} value={unit}>
                {unitWords[unit]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id={box('direction')}
          label={`${label} direction`}
          error={error(box('direction'))}
        >
          <Select
            value={indicator.direction}
            onChange={(event) => {
              onChange({
                ...indicator,
                direction: event.currentTarget.value as IndicatorDirection,
              });
            }}
          >
            {indicatorDirections.map((direction) => (
              <option key={direction} value={direction}>
                {directionWords[direction]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id={box('aggregation')}
          label={`${label} combining`}
          error={error(box('aggregation'))}
        >
          <Select
            value={indicator.aggregation}
            onChange={(event) => {
              onChange({
                ...indicator,
                aggregation: event.currentTarget.value as IndicatorAggregation,
              });
            }}
          >
            {indicatorAggregations.map((aggregation) => (
              <option key={aggregation} value={aggregation}>
                {aggregationWords[aggregation]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <div>
        <Button variant="quiet" onClick={onRemove}>
          Remove {label.toLowerCase()}
        </Button>
      </div>
    </li>
  );
}

function OutcomeEditor({
  outcome,
  number,
  onChange,
  onRemove,
  onAddIndicator,
  onRemoveIndicator,
  error,
}: {
  outcome: OutcomeDraft;
  number: number;
  onChange: (outcome: OutcomeDraft) => void;
  onRemove: () => void;
  onAddIndicator: () => void;
  onRemoveIndicator: (id: string) => void;
  error: ErrorFor;
}) {
  const box = (part: string) => `outcome-${outcome.id}-${part}`;
  const at = String(number);
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-divider p-4">
      <legend className="px-1 text-lg font-semibold tracking-tight text-ink">Outcome {at}</legend>
      <FormField
        id={box('name')}
        label={`Outcome ${at} name`}
        hint="The change you want to see, such as older people feel less isolated."
        error={error(box('name'))}
      >
        <Input
          value={outcome.name}
          autoComplete="off"
          onChange={(event) => {
            onChange({ ...outcome, name: event.currentTarget.value });
          }}
        />
      </FormField>
      <FormField
        id={box('description')}
        label={`Outcome ${at} description`}
        optional
        error={error(box('description'))}
      >
        <Textarea
          rows={3}
          value={outcome.description}
          onChange={(event) => {
            onChange({ ...outcome, description: event.currentTarget.value });
          }}
        />
      </FormField>
      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-ink">Indicators for outcome {at}</h3>
        {outcome.indicators.length === 0 ? (
          <p className="text-body text-muted">
            No indicators yet. Add one to measure this outcome with a figure.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {outcome.indicators.map((indicator, index) => (
              <IndicatorRow
                key={indicator.id}
                indicator={indicator}
                label={`Indicator ${at}.${String(index + 1)}`}
                error={error}
                onChange={(next) => {
                  onChange({
                    ...outcome,
                    indicators: outcome.indicators.map((item) =>
                      item.id === next.id ? next : item,
                    ),
                  });
                }}
                onRemove={() => {
                  onRemoveIndicator(indicator.id);
                }}
              />
            ))}
          </ul>
        )}
        <div>
          <Button id={box('add-indicator')} onClick={onAddIndicator}>
            Add an indicator to outcome {at}
          </Button>
        </div>
      </div>
      <div>
        <Button variant="quiet" onClick={onRemove}>
          Remove outcome {at}
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * Makes a framework or, given one, changes it. Either way it opens the
 * framework's page once saved.
 */
export function FrameworkForm({ framework }: { framework?: Framework }) {
  const navigate = useNavigate();
  const [initial] = useState(() => frameworkDraft(framework));
  const [draft, setDraft] = useState<FrameworkDraft>(initial);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusAfter = useRef<string | null>(null);

  useLeaveGuard(savedId === null && JSON.stringify(draft) !== JSON.stringify(initial));

  // Leave once the guard has gone: it goes when the page draws again without it.
  useEffect(() => {
    if (savedId !== null) navigate(frameworkPath(savedId));
  }, [savedId, navigate]);

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [draft]);

  const form = useSubmit(
    frameworkBoxes(draft),
    naming(boxFor, async () => {
      const body = frameworkBody(draft);
      setSavedId(
        framework === undefined
          ? (await call(createFramework, { body })).id
          : (await call(updateFramework, { params: { frameworkId: framework.id }, body })).id,
      );
    }),
  );

  if (framework !== undefined && framework.archivedAt !== null) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <Notice tone="warning" title="This framework is archived">
          An archived framework takes no changes, targets or results. Make a new framework to start
          again.
        </Notice>
        <div>
          <LinkButton to={frameworkPath(framework.id)}>Back to framework</LinkButton>
        </div>
      </div>
    );
  }

  const indicatorTotal = draft.outcomes.reduce((sum, { indicators }) => sum + indicators.length, 0);

  function change(next: FrameworkDraft, say: string, focus: string) {
    setDraft(next);
    setAnnouncement(say);
    focusAfter.current = focus;
  }

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-3xl flex-col gap-5">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField id="name" label="Name" error={form.errorFor('name')}>
        <Input
          value={draft.name}
          autoComplete="off"
          onChange={(event) => {
            setDraft({ ...draft, name: event.currentTarget.value });
          }}
        />
      </FormField>
      <FormField
        id="description"
        label="Description"
        optional
        hint="What the framework is for. Leave a blank line between paragraphs."
        error={form.errorFor('description')}
      >
        <Textarea
          rows={4}
          value={draft.description}
          onChange={(event) => {
            setDraft({ ...draft, description: event.currentTarget.value });
          }}
        />
      </FormField>
      {draft.outcomes.map((outcome, index) => (
        <OutcomeEditor
          key={outcome.id}
          outcome={outcome}
          number={index + 1}
          error={form.errorFor}
          onChange={(next) => {
            setDraft({
              ...draft,
              outcomes: draft.outcomes.map((item) => (item.id === next.id ? next : item)),
            });
          }}
          onRemove={() => {
            change(
              { ...draft, outcomes: draft.outcomes.filter((item) => item.id !== outcome.id) },
              `Outcome ${String(index + 1)} removed.`,
              'add-outcome',
            );
          }}
          onAddIndicator={() => {
            const added = blankIndicator();
            change(
              {
                ...draft,
                outcomes: draft.outcomes.map((item) =>
                  item.id === outcome.id
                    ? { ...item, indicators: [...item.indicators, added] }
                    : item,
                ),
              },
              'Indicator added.',
              `indicator-${added.id}-name`,
            );
          }}
          onRemoveIndicator={(id) => {
            change(
              {
                ...draft,
                outcomes: draft.outcomes.map((item) =>
                  item.id === outcome.id
                    ? { ...item, indicators: item.indicators.filter((entry) => entry.id !== id) }
                    : item,
                ),
              },
              'Indicator removed.',
              `outcome-${outcome.id}-add-indicator`,
            );
          }}
        />
      ))}
      <div className="flex flex-col gap-1">
        <div>
          <Button
            id="add-outcome"
            aria-disabled={draft.outcomes.length >= MAX_OUTCOMES || undefined}
            onClick={() => {
              if (draft.outcomes.length >= MAX_OUTCOMES) return;
              const added = blankOutcome();
              change(
                { ...draft, outcomes: [...draft.outcomes, added] },
                'Outcome added.',
                `outcome-${added.id}-name`,
              );
            }}
          >
            Add an outcome
          </Button>
        </div>
        <p className="text-sm text-muted">
          {draft.outcomes.length} of {MAX_OUTCOMES} outcomes and {indicatorTotal} of{' '}
          {MAX_INDICATORS} indicators.
        </p>
        {form.errorFor('add-outcome') && (
          <p className="text-body font-medium text-danger">{form.errorFor('add-outcome')}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          {framework === undefined ? 'Create framework' : 'Save framework'}
        </Button>
        <LinkButton to={framework === undefined ? IMPACT_PATH : frameworkPath(framework.id)}>
          Cancel
        </LinkButton>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
    </form>
  );
}
