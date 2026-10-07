// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  buttonClassName,
  ErrorSummary,
  FieldGroup,
  FormField,
  Input,
  Link,
  Meter,
  PageHeader,
  Panel,
  SaveStatus,
  Tag,
  Textarea,
} from '@pixel-scientists/ui';
import type { SaveState } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { moments, scale } from '../story.ts';
import { dateOnly, springRound, today } from './data.ts';
import { rubric, rubricVersion, TOTAL_WEIGHT } from './rubricData.ts';
import type { RubricCriterion } from './rubricData.ts';

function StatusIcon({ ok }: { ok: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ok ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M8 3.5v5M8 12v.01" />}
    </svg>
  );
}

function TotalWeight({ total }: { total: number }) {
  const valid = total === TOTAL_WEIGHT;
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={valid ? 'text-success' : 'text-danger'}>
        <StatusIcon ok={valid} />
      </span>
      <span className="text-sm font-medium text-muted">Total weight</span>
      <span className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{total}</span>
      <span className="text-sm text-muted">of {TOTAL_WEIGHT}</span>
      {!valid && (
        <span className="text-sm font-medium text-danger">
          Weights must add up to {TOTAL_WEIGHT}
        </span>
      )}
    </p>
  );
}

/** The criteria a round's reviewers score against: each with its weight and what every score from 1 to 5 means. */
export default function Rubric() {
  const [items, setItems] = useState<readonly RubricCriterion[]>(rubric);
  const [saved, setSaved] = useState<SaveState>({ status: 'idle' });
  const [version, setVersion] = useState(rubricVersion);
  const [dirty, setDirty] = useState(false);
  const [unchanged, setUnchanged] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [moved, setMoved] = useState('');
  const refocus = useRef<string | null>(null);

  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const valid = total === TOTAL_WEIGHT;

  useEffect(() => {
    if (refocus.current === null) return;
    document.getElementById(refocus.current)?.focus();
    refocus.current = null;
  }, [items]);

  function change(id: string, patch: (item: RubricCriterion) => Partial<RubricCriterion>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch(item) } : item)),
    );
    setDirty(true);
    setUnchanged(false);
    setSaved({ status: 'idle' });
  }

  function move(index: number, by: -1 | 1) {
    const item = items[index];
    const target = index + by;
    if (!item || target < 0 || target >= items.length) return;
    const next = items.filter((_, position) => position !== index);
    next.splice(target, 0, item);
    setItems(next);
    setDirty(true);
    setUnchanged(false);
    setSaved({ status: 'idle' });
    refocus.current = `${item.id}-${by === -1 ? 'up' : 'down'}`;
    setMoved(`${item.label} moved to position ${String(target + 1)} of ${String(items.length)}`);
  }

  function save() {
    if (!dirty) {
      setUnchanged(true);
      return;
    }
    if (!valid) {
      setAttempts((count) => count + 1);
      return;
    }
    setAttempts(0);
    setVersion({ number: version.number + 1, saved: today });
    setDirty(false);
    setSaved({ status: 'saved', at: moments.applying });
  }

  const firstWeight = items[0] ? `${items[0].id}-weight` : '';
  const weightError =
    attempts > 0 && !valid
      ? `Weights add up to ${String(total)}. Change them so they add up to ${String(TOTAL_WEIGHT)}.`
      : undefined;

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[
          { label: 'Programmes', to: '/programmes' },
          { label: 'Community Grants', to: '/programmes/community-grants' },
          { label: 'Spring 2027', to: '/programmes/community-grants/spring-2027' },
          { label: 'Rubric' },
        ]}
        eyebrow={<Tag tone="info">Design preview</Tag>}
        title="Rubric"
        description={
          <>
            <span className="block">
              Reviewers score every application from 1 to 5 on each criterion. The weights decide
              how much each one counts towards the total.
            </span>
            <span className="mt-2 block font-medium text-ink">
              Version {version.number}, saved {version.saved}
            </span>
            <span role="status" className="block">
              {unchanged
                ? `Nothing has changed since version ${String(version.number)}, so there is nothing to save.`
                : saved.status === 'saved'
                  ? `Saved as version ${String(version.number)}.`
                  : `No reviews have been scored yet. Saving makes version ${String(version.number + 1)}; reviews start after the round closes on ${dateOnly(springRound.closes)}.`}
            </span>
          </>
        }
        actions={
          <>
            <SaveStatus state={saved} />
            <Link to="/reviews/NF-CG-0398" className={buttonClassName('secondary')}>
              Preview as a reviewer
            </Link>
            <Button variant="primary" onClick={save}>
              Save rubric
            </Button>
          </>
        }
      />
      {attempts > 0 && !valid && (
        <ErrorSummary
          key={attempts}
          errors={[
            {
              fieldId: firstWeight,
              message: `Weights add up to ${String(total)}. Change them so they add up to ${String(TOTAL_WEIGHT)}.`,
            },
          ]}
        />
      )}
      <Panel title="Weights" actions={<TotalWeight total={total} />}>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((item) => (
            <Meter
              key={item.id}
              label={item.label}
              value={item.weight}
              max={Math.max(total, 1)}
              valueText={`${String(Math.round((item.weight / Math.max(total, 1)) * 100))}%`}
            />
          ))}
        </div>
      </Panel>
      <section aria-labelledby="criteria-heading" className="flex flex-col gap-1">
        <h2 id="criteria-heading" className="text-lg font-semibold tracking-tight text-ink">
          Criteria
        </h2>
        <p className="text-body text-muted">Reviewers see the criteria in this order.</p>
        <p role="status" className="sr-only">
          {moved}
        </p>
        <ol
          role="list"
          className="mt-2 flex flex-col divide-y divide-divider border-y border-divider"
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              className="grid gap-x-5 gap-y-4 py-6 sm:grid-cols-[1.25rem_minmax(0,1fr)]"
            >
              <span
                aria-hidden="true"
                className="hidden pt-8 text-sm font-medium text-muted tabular-nums sm:block"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                  <FormField
                    label={
                      <>
                        Criterion<span className="sr-only"> {index + 1}</span>
                      </>
                    }
                    className="min-w-64 flex-1"
                  >
                    <Input
                      value={item.label}
                      autoComplete="off"
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        change(item.id, () => ({ label }));
                      }}
                    />
                  </FormField>
                  <FormField
                    id={`${item.id}-weight`}
                    label={
                      <>
                        Weight<span className="sr-only"> for {item.label}</span>
                      </>
                    }
                    error={index === 0 ? weightError : undefined}
                    className={index === 0 && weightError ? 'w-64' : 'w-24'}
                  >
                    <Input
                      value={String(item.weight)}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={2}
                      className="tabular-nums"
                      onChange={(event) => {
                        const weight = Number(event.currentTarget.value.replace(/\D/g, ''));
                        change(item.id, () => ({ weight }));
                      }}
                    />
                  </FormField>
                  <div className="flex gap-1">
                    <Button
                      id={`${item.id}-up`}
                      variant="quiet"
                      aria-disabled={index === 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                    >
                      Move up<span className="sr-only"> {item.label}</span>
                    </Button>
                    <Button
                      id={`${item.id}-down`}
                      variant="quiet"
                      aria-disabled={index === items.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                    >
                      Move down<span className="sr-only"> {item.label}</span>
                    </Button>
                  </div>
                </div>
                <FormField
                  label={
                    <>
                      Guidance for reviewers<span className="sr-only"> on {item.label}</span>
                    </>
                  }
                >
                  <Textarea
                    rows={2}
                    className="resize-y"
                    value={item.guidance}
                    onChange={(event) => {
                      const guidance = event.currentTarget.value;
                      change(item.id, () => ({ guidance }));
                    }}
                  />
                </FormField>
                <FieldGroup legend="What each score means">
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {scale.map(({ score, label }) => (
                      <FormField
                        key={score}
                        label={
                          <>
                            <span className="sr-only">{item.label}, score </span>
                            {score}. {label}
                          </>
                        }
                      >
                        <Textarea
                          rows={4}
                          className="resize-none"
                          value={item.descriptors[score - 1] ?? ''}
                          onChange={(event) => {
                            const text = event.currentTarget.value;
                            change(item.id, (current) => ({
                              descriptors: current.descriptors.map((descriptor, position) =>
                                position === score - 1 ? text : descriptor,
                              ),
                            }));
                          }}
                        />
                      </FormField>
                    ))}
                  </div>
                </FieldGroup>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
