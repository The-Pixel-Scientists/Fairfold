// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  Button,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Meter,
  PageHeader,
  Panel,
  Textarea,
  useLeaveGuard,
  useLoad,
  useSubmit,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { MAX_CRITERIA, setRubric } from '../../contracts/index.ts';
import type { Stage } from '../../contracts/index.ts';
import { FormFooter } from './FormFooter.tsx';
import { loadRound } from './loaders.ts';
import { LinkButton, ManagePage, useParam } from './Page.tsx';
import { PROGRAMMES_PATH, programmePath, roundPath } from './paths.ts';
import { naming } from './problems.ts';
import { BOXES, boxFor, boxId, contentOf, itemsOf, numberOf, rubricBody } from './rubricDraft.ts';
import type { Item } from './rubricDraft.ts';

/** A weight as a percentage of the total, for the bars. */
const shareOf = (weight: number, total: number) =>
  total > 0 ? `${String(Math.round((weight / total) * 100))}%` : '0%';

function RubricEditor({ roundId, stage }: { roundId: string; stage: Stage }) {
  const [saved, setSaved] = useState(() => itemsOf(stage.criteria));
  const [items, setItems] = useState(saved);
  const [done, setDone] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const nextKey = useRef(0);
  const focusAfter = useRef<string | null>(null);

  useLeaveGuard(contentOf(items) !== contentOf(saved));

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [items]);

  const form = useSubmit(
    [...items.flatMap((_, index) => BOXES.map((box) => boxId(index, box))), 'add-criterion'],
    naming(boxFor, async () => {
      const result = await call(setRubric, {
        params: { stageId: stage.id },
        body: rubricBody(items),
      });
      setSaved(itemsOf(result.criteria));
      setItems(itemsOf(result.criteria));
      setDone(true);
    }),
  );

  const total = items.reduce((sum, { weight }) => sum + numberOf(weight), 0);
  const nameOf = (item: Item, index: number) =>
    item.label.trim() || `criterion ${String(index + 1)}`;

  function change(next: Item[], say: string, focus: string) {
    setItems(next);
    setDone(false);
    setAnnouncement(say);
    focusAfter.current = focus;
  }

  function edit(key: string, patch: Partial<Item>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    setDone(false);
  }

  function move(index: number, by: -1 | 1) {
    const item = items[index];
    const target = index + by;
    if (item === undefined || target < 0 || target >= items.length) return;
    const next = items.filter((_, position) => position !== index);
    next.splice(target, 0, item);
    change(
      next,
      `${nameOf(item, index)} moved to position ${String(target + 1)} of ${String(items.length)}`,
      boxId(target, by === -1 ? 'up' : 'down'),
    );
  }

  function remove(index: number) {
    const item = items[index];
    if (item === undefined) return;
    change(
      items.filter((_, position) => position !== index),
      `${nameOf(item, index)} removed`,
      items.length > 1 ? boxId(Math.min(index, items.length - 2), 'label') : 'add-criterion',
    );
  }

  function add() {
    if (items.length >= MAX_CRITERIA) return;
    nextKey.current += 1;
    change(
      [
        ...items,
        {
          key: `new-${String(nextKey.current)}`,
          label: '',
          guidance: '',
          weight: '',
          scaleMin: '1',
          scaleMax: '5',
        },
      ],
      'Criterion added',
      boxId(items.length, 'label'),
    );
  }

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-stack">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      {items.length > 0 && (
        <Panel
          title="Weights"
          actions={
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium text-muted">Total weight</span>
              <span className="text-2xl font-semibold tracking-tight text-ink tabular-nums">
                {total}
              </span>
            </p>
          }
        >
          <p className="-mt-2 text-sm text-muted">
            Weights are whole numbers from 1 to 100. A criterion with a weight of 4 counts twice as
            much as one with a weight of 2.
          </p>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <Meter
                key={item.key}
                label={item.label.trim() || `Criterion ${String(index + 1)}`}
                value={numberOf(item.weight)}
                max={Math.max(total, 1)}
                valueText={shareOf(numberOf(item.weight), total)}
              />
            ))}
          </div>
        </Panel>
      )}
      <section aria-labelledby="criteria-heading" className="flex flex-col gap-2">
        <h2 id="criteria-heading" className="text-lg font-semibold tracking-tight text-ink">
          Criteria
        </h2>
        <p className="text-body text-muted">
          Reviewers see the criteria in this order. A score runs from the lowest score to the
          highest, between 0 and 10.
        </p>
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {items.length === 0 ? (
          <EmptyState title="No rubric for this stage" headingLevel="h3">
            <p>
              Add a criterion to make this a stage where reviewers score. Leave it empty if nobody
              scores here.
            </p>
          </EmptyState>
        ) : (
          <ol role="list" className="flex flex-col divide-y divide-divider border-y border-divider">
            {items.map((item, index) => (
              <li key={item.key} className="flex flex-col gap-3 py-5">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                  <FormField
                    id={boxId(index, 'label')}
                    label={
                      <>
                        Criterion<span className="sr-only"> {index + 1}</span>
                      </>
                    }
                    error={form.errorFor(boxId(index, 'label'))}
                    className="min-w-64 flex-1"
                  >
                    <Input
                      value={item.label}
                      autoComplete="off"
                      onChange={(event) => {
                        edit(item.key, { label: event.currentTarget.value });
                      }}
                    />
                  </FormField>
                  <FormField
                    id={boxId(index, 'weight')}
                    label={
                      <>
                        Weight<span className="sr-only"> for {nameOf(item, index)}</span>
                      </>
                    }
                    error={form.errorFor(boxId(index, 'weight'))}
                    className="w-28"
                  >
                    <Input
                      value={item.weight}
                      inputMode="numeric"
                      autoComplete="off"
                      className="tabular-nums"
                      onChange={(event) => {
                        edit(item.key, { weight: event.currentTarget.value });
                      }}
                    />
                  </FormField>
                  <FormField
                    id={boxId(index, 'scaleMin')}
                    label={
                      <>
                        Lowest score<span className="sr-only"> for {nameOf(item, index)}</span>
                      </>
                    }
                    error={form.errorFor(boxId(index, 'scaleMin'))}
                    className="w-28"
                  >
                    <Input
                      value={item.scaleMin}
                      inputMode="numeric"
                      autoComplete="off"
                      className="tabular-nums"
                      onChange={(event) => {
                        edit(item.key, { scaleMin: event.currentTarget.value });
                      }}
                    />
                  </FormField>
                  <FormField
                    id={boxId(index, 'scaleMax')}
                    label={
                      <>
                        Highest score<span className="sr-only"> for {nameOf(item, index)}</span>
                      </>
                    }
                    error={form.errorFor(boxId(index, 'scaleMax'))}
                    className="w-28"
                  >
                    <Input
                      value={item.scaleMax}
                      inputMode="numeric"
                      autoComplete="off"
                      className="tabular-nums"
                      onChange={(event) => {
                        edit(item.key, { scaleMax: event.currentTarget.value });
                      }}
                    />
                  </FormField>
                  <div className="flex gap-1">
                    <Button
                      id={boxId(index, 'up')}
                      variant="quiet"
                      aria-disabled={index === 0 || undefined}
                      onClick={() => {
                        move(index, -1);
                      }}
                    >
                      Move up<span className="sr-only"> {nameOf(item, index)}</span>
                    </Button>
                    <Button
                      id={boxId(index, 'down')}
                      variant="quiet"
                      aria-disabled={index === items.length - 1 || undefined}
                      onClick={() => {
                        move(index, 1);
                      }}
                    >
                      Move down<span className="sr-only"> {nameOf(item, index)}</span>
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        remove(index);
                      }}
                    >
                      Remove<span className="sr-only"> {nameOf(item, index)}</span>
                    </Button>
                  </div>
                </div>
                <FormField
                  id={boxId(index, 'guidance')}
                  label={
                    <>
                      Guidance for reviewers
                      <span className="sr-only"> on {nameOf(item, index)}</span>
                    </>
                  }
                  optional
                  error={form.errorFor(boxId(index, 'guidance'))}
                >
                  <Textarea
                    rows={2}
                    className="resize-y"
                    value={item.guidance}
                    onChange={(event) => {
                      edit(item.key, { guidance: event.currentTarget.value });
                    }}
                  />
                </FormField>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-col items-start gap-1">
          <Button
            id="add-criterion"
            aria-disabled={items.length >= MAX_CRITERIA || undefined}
            aria-describedby="criteria-limit"
            onClick={add}
          >
            Add criterion
          </Button>
          <p id="criteria-limit" className="text-sm text-muted">
            A rubric has up to {MAX_CRITERIA} criteria.
          </p>
        </div>
      </section>
      <FormFooter
        save="Save rubric"
        pending={form.pending}
        back="Back to round"
        backTo={roundPath(roundId)}
        saved={done && 'Rubric saved.'}
      />
    </form>
  );
}

function Rubric({ roundId, stageId }: { roundId: string; stageId: string }) {
  const { state, retry } = useLoad(loadRound, roundId);
  const loaded = state.status === 'ready' ? state.value : null;
  const stage = loaded?.stages.find(({ id }) => id === stageId);

  return (
    <>
      <PageHeader
        breadcrumbs={
          loaded && stage
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: loaded.programme.title, to: programmePath(loaded.programme.id) },
                { label: loaded.round.title, to: roundPath(roundId) },
                { label: `Rubric for ${stage.name}` },
              ]
            : undefined
        }
        title={stage ? `Rubric for ${stage.name}` : 'Rubric'}
        description="Reviewers score each application on these criteria. The weights decide how much each one counts towards the total."
      />
      <WhenLoaded state={state} label="Loading the rubric" retry={retry}>
        {({ stages }) => {
          const found = stages.find(({ id }) => id === stageId);
          return found === undefined ? (
            <EmptyState
              title="We cannot find this stage"
              action={<LinkButton to={roundPath(roundId)}>Back to round</LinkButton>}
            >
              <p>It may have been removed from the round. Open the round to see its stages.</p>
            </EmptyState>
          ) : (
            <RubricEditor roundId={roundId} stage={found} />
          );
        }}
      </WhenLoaded>
    </>
  );
}

export default function RubricPage() {
  return (
    <ManagePage title="Rubric">
      <Rubric roundId={useParam('roundId')} stageId={useParam('stageId')} />
    </ManagePage>
  );
}
