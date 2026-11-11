// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds an equality monitoring form: which of the fixed questions to ask and
// in what order. Every question is optional, has "Prefer not to say" and is
// seen only in totals, so none of that can be changed here, and there is no
// way to add an identity or file question.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { Button, Checkbox } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { monitoringQuestions } from '../../contracts/index.ts';
import { askedIds, withQuestions } from './monitoring.ts';
import type { MonitoringIssue } from './monitoring.ts';

export const listId = 'monitoring-questions';
export const statusId = 'monitoring-status';
export const checkboxId = (fieldId: string) => `monitoring-${fieldId}`;
const moveId = (fieldId: string, by: -1 | 1) => `${checkboxId(fieldId)}-${by < 0 ? 'up' : 'down'}`;
const issueId = (fieldId: string, n: number) => `${checkboxId(fieldId)}-issue-${String(n)}`;

const labelOf = (id: string) => monitoringQuestions.get(id)?.label ?? id;

export function MonitoringEditor({
  definition,
  onChange,
  issues,
}: {
  definition: FormDefinition;
  onChange: (definition: FormDefinition) => void;
  issues: readonly MonitoringIssue[];
}) {
  const asked = askedIds(definition);
  const left = [...monitoringQuestions.keys()].filter((id) => !asked.includes(id));
  const change = (ids: readonly string[]) => {
    onChange(withQuestions(ids));
  };
  const [announcement, setAnnouncement] = useState('');
  const moved = useRef<{ id: string; by: -1 | 1 } | null>(null);
  const announced = useRef(new Set<string>());

  const move = (index: number, by: -1 | 1) => {
    const next = [...asked];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + by, 0, item);
    moved.current = { id: item, by };
    setAnnouncement(
      `${labelOf(item)} moved to position ${String(index + by + 1)} of ${String(next.length)}.`,
    );
    change(next);
  };

  useEffect(() => {
    const target = moved.current;
    if (target === null) return;
    moved.current = null;
    const index = asked.indexOf(target.id);
    const atEdge = target.by < 0 ? index === 0 : index === asked.length - 1;
    document
      .getElementById(moveId(target.id, atEdge ? (-target.by as -1 | 1) : target.by))
      ?.focus();
  }, [asked]);

  useEffect(() => {
    const own = issues.flatMap(({ fieldId, message }) =>
      fieldId === null
        ? []
        : [{ key: `${fieldId}:${message}`, text: `${labelOf(fieldId)}: ${message}` }],
    );
    const fresh = own.filter(({ key }) => !announced.current.has(key));
    announced.current = new Set(own.map(({ key }) => key));
    if (fresh.length > 0) setAnnouncement(fresh.map(({ text }) => text).join(' '));
  }, [issues]);

  return (
    <section aria-labelledby="monitoring-heading" className="flex max-w-prose flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="monitoring-heading" className="text-lg font-semibold tracking-tight text-ink">
          Questions to ask
        </h2>
        <p className="text-body text-muted">
          Every question is optional, has a &quot;Prefer not to say&quot; choice, and is seen only
          in totals. Staff and reviewers never see an individual answer. You choose which questions
          to ask and in what order.
        </p>
      </div>
      <p id={statusId} role="status" className="sr-only">
        {announcement}
      </p>
      <ul id={listId} tabIndex={-1} aria-label="Questions" className="flex flex-col gap-2">
        {[...asked, ...left].map((id) => {
          const index = asked.indexOf(id);
          const included = index >= 0;
          const found = issues.filter((issue) => issue.fieldId === id);
          return (
            <li
              key={id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-divider p-3"
            >
              <div
                role="group"
                aria-label={labelOf(id)}
                aria-describedby={
                  found.length === 0 ? undefined : found.map((_, n) => issueId(id, n)).join(' ')
                }
                className="flex flex-col gap-1"
              >
                <Checkbox
                  id={checkboxId(id)}
                  label={labelOf(id)}
                  checked={included}
                  onCheckedChange={(checked) => {
                    change(checked ? [...asked, id] : asked.filter((item) => item !== id));
                  }}
                />
                {found.map((issue, n) => (
                  <p
                    key={issue.message}
                    id={issueId(id, n)}
                    className="text-sm font-medium text-danger"
                  >
                    {issue.message}
                  </p>
                ))}
              </div>
              {included && (
                <div className="flex gap-2">
                  <Button
                    id={moveId(id, -1)}
                    variant="quiet"
                    aria-disabled={index === 0 || undefined}
                    onClick={() => {
                      if (index > 0) move(index, -1);
                    }}
                  >
                    Move up<span className="sr-only"> {labelOf(id)}</span>
                  </Button>
                  <Button
                    id={moveId(id, 1)}
                    variant="quiet"
                    aria-disabled={index === asked.length - 1 || undefined}
                    onClick={() => {
                      if (index < asked.length - 1) move(index, 1);
                    }}
                  >
                    Move down<span className="sr-only"> {labelOf(id)}</span>
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
