// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  PageHeader,
  useLeaveGuard,
  useLoad,
  useSubmit,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { MAX_STAGES, setStages } from '../../contracts/index.ts';
import type { Stage } from '../../contracts/index.ts';
import { FormFooter } from './FormFooter.tsx';
import { loadRound } from './loaders.ts';
import { ManagePage, useParam } from './Page.tsx';
import { PROGRAMMES_PATH, programmePath, roundPath } from './paths.ts';
import { naming } from './problems.ts';

interface Item {
  /** Keeps a row's place while its name changes and the rows move. */
  key: string;
  /** Left out for a stage that has not been saved yet. */
  id?: string;
  name: string;
}

const itemsOf = (stages: readonly Stage[]): Item[] =>
  stages.map(({ id, name }) => ({ key: id, id, name }));

/** What the API keeps of the rows: which stage, and its name, in order. */
const contentOf = (items: readonly Item[]) =>
  JSON.stringify(items.map(({ id, name }) => ({ id, name })));

const nameId = (index: number) => `stage-${String(index)}-name`;

/** `body.stages.2.name` is the box for the third stage's name. */
function boxFor(field: string): string {
  const index = /^body\.stages\.(\d+)\./.exec(field)?.[1];
  return index === undefined ? 'add-stage' : nameId(Number(index));
}

function StageEditor({ roundId, stages }: { roundId: string; stages: readonly Stage[] }) {
  const [saved, setSaved] = useState(() => itemsOf(stages));
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
    [...items.map((_, index) => nameId(index)), 'add-stage'],
    naming(boxFor, async () => {
      const result = await call(setStages, {
        params: { roundId },
        body: { stages: items.map(({ id, name }) => (id === undefined ? { name } : { id, name })) },
      });
      setSaved(itemsOf(result.stages));
      setItems(itemsOf(result.stages));
      setDone(true);
    }),
  );

  const labelOf = (item: Item, index: number) => item.name.trim() || `stage ${String(index + 1)}`;

  function change(next: Item[], say: string, focus: string) {
    setItems(next);
    setDone(false);
    setAnnouncement(say);
    focusAfter.current = focus;
  }

  function move(index: number, by: -1 | 1) {
    const item = items[index];
    const target = index + by;
    if (item === undefined || target < 0 || target >= items.length) return;
    const next = items.filter((_, position) => position !== index);
    next.splice(target, 0, item);
    change(
      next,
      `${labelOf(item, index)} moved to position ${String(target + 1)} of ${String(items.length)}`,
      `stage-${String(target)}-${by === -1 ? 'up' : 'down'}`,
    );
  }

  function remove(index: number) {
    const item = items[index];
    if (item === undefined || items.length === 1) return;
    change(
      items.filter((_, position) => position !== index),
      `${labelOf(item, index)} removed`,
      nameId(Math.min(index, items.length - 2)),
    );
  }

  function add() {
    if (items.length >= MAX_STAGES) return;
    nextKey.current += 1;
    change(
      [...items, { key: `new-${String(nextKey.current)}`, name: '' }],
      'Stage added',
      nameId(items.length),
    );
  }

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-3xl flex-col gap-5">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ol role="list" className="flex flex-col divide-y divide-divider border-y border-divider">
        {items.map((item, index) => (
          <li key={item.key} className="flex flex-wrap items-end gap-x-3 gap-y-2 py-3">
            <FormField
              id={nameId(index)}
              label={
                <>
                  Stage name<span className="sr-only"> {index + 1}</span>
                </>
              }
              error={form.errorFor(nameId(index))}
              className="min-w-56 flex-1"
            >
              <Input
                value={item.name}
                autoComplete="off"
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setItems((current) =>
                    current.map((candidate) =>
                      candidate.key === item.key ? { ...candidate, name } : candidate,
                    ),
                  );
                  setDone(false);
                }}
              />
            </FormField>
            <div className="flex gap-1">
              <Button
                id={`stage-${String(index)}-up`}
                variant="quiet"
                aria-disabled={index === 0 || undefined}
                onClick={() => {
                  move(index, -1);
                }}
              >
                Move up<span className="sr-only"> {labelOf(item, index)}</span>
              </Button>
              <Button
                id={`stage-${String(index)}-down`}
                variant="quiet"
                aria-disabled={index === items.length - 1 || undefined}
                onClick={() => {
                  move(index, 1);
                }}
              >
                Move down<span className="sr-only"> {labelOf(item, index)}</span>
              </Button>
              <Button
                variant="quiet"
                aria-disabled={items.length === 1 || undefined}
                onClick={() => {
                  remove(index);
                }}
              >
                Remove<span className="sr-only"> {labelOf(item, index)}</span>
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-col items-start gap-1">
        <Button
          id="add-stage"
          aria-disabled={items.length >= MAX_STAGES || undefined}
          aria-describedby="stage-limit"
          onClick={add}
        >
          Add stage
        </Button>
        <p id="stage-limit" className="text-sm text-muted">
          A round has up to {MAX_STAGES} stages. Removing a stage also removes its rubric.
        </p>
      </div>
      <FormFooter
        save="Save stages"
        pending={form.pending}
        back="Back to round"
        backTo={roundPath(roundId)}
        saved={done && 'Stages saved.'}
      />
    </form>
  );
}

function Stages({ roundId }: { roundId: string }) {
  const { state, retry } = useLoad(loadRound, roundId);
  const loaded = state.status === 'ready' ? state.value : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          loaded
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: loaded.programme.title, to: programmePath(loaded.programme.id) },
                { label: loaded.round.title, to: roundPath(roundId) },
                { label: 'Stages' },
              ]
            : undefined
        }
        title="Stages"
        description="Every application moves through these stages in order. A person moves it on; nothing is decided automatically."
      />
      <WhenLoaded state={state} label="Loading the stages" retry={retry}>
        {({ stages }) => <StageEditor roundId={roundId} stages={stages} />}
      </WhenLoaded>
    </>
  );
}

export default function StagesPage() {
  return (
    <ManagePage title="Stages">
      <Stages roundId={useParam('roundId')} />
    </ManagePage>
  );
}
