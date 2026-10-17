// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form's outline: its sections, and the questions of the one that is
// showing. Selecting an item shows its settings beside them.

import type { FormField } from '@pixel-scientists/domain/forms';
import { Button, cx, Tag } from '@pixel-scientists/ui';

import type { Section } from './draft.ts';
import { typeLabel } from './words.ts';

/** A button that selects one of a set, marked by a sheet behind it, heavier text and a bar at its start. */
const selectable = cx(
  'relative flex w-full text-start transition-colors duration-(--motion-fast) ease-standard hover:bg-sunken',
  'aria-[current=true]:bg-accent-soft aria-[current=true]:before:absolute aria-[current=true]:before:inset-y-2',
  "aria-[current=true]:before:left-0 aria-[current=true]:before:w-[3px] aria-[current=true]:before:rounded-full aria-[current=true]:before:bg-accent aria-[current=true]:before:content-['']",
);

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

const ProblemTag = () => <Tag tone="danger">Has a problem</Tag>;

export function SectionList({
  sections,
  currentId,
  flagged,
  onSelect,
  onAdd,
}: {
  sections: readonly Section[];
  currentId: string;
  flagged: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Sections</h2>
      <ul role="list" aria-label="Sections" className="flex flex-wrap gap-1 xl:flex-col">
        {sections.map((section, index) => (
          <li key={section.id} className="xl:w-full">
            <button
              id={`outline-${section.id}`}
              type="button"
              aria-current={section.id === currentId ? 'true' : undefined}
              onClick={() => {
                onSelect(section.id);
              }}
              className={cx(
                selectable,
                'min-h-control items-center justify-between gap-3 rounded-md px-3 text-body text-muted hover:text-ink aria-[current=true]:font-semibold aria-[current=true]:text-ink',
              )}
            >
              <span className="flex flex-col items-start gap-1">
                <span>
                  <span className="tabular-nums">{index + 1}.</span>{' '}
                  {section.title === '' ? 'Untitled section' : section.title}
                </span>
                {flagged.has(section.id) && <ProblemTag />}
              </span>
              <span className="tabular-nums">
                {section.fields.length}
                <span className="sr-only"> questions</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button id="add-section" variant="quiet" className="self-start" onClick={onAdd}>
        <PlusIcon />
        Add section
      </Button>
    </div>
  );
}

/** What a question's row says about it besides its label: whether it is required, who sees it and what depends on it. */
function notesOf(field: FormField): string {
  if (field.type === 'content') {
    return field.conditions.length > 0 ? 'Shown only for some answers' : '';
  }
  const hidden =
    field.audiences === 'aggregate_only'
      ? 'Only in totals'
      : field.audiences.includes('reviewer')
        ? ''
        : 'Hidden from reviewers';
  return [
    field.required ? 'Required' : 'Optional',
    field.conditions.length > 0 ? 'Shown only for some answers' : '',
    hidden,
    field.identity ? 'Hidden from blind reviewers' : '',
    'eligibility' in field && field.eligibility !== undefined ? 'Stops some applicants' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const nameOf = (field: FormField): string =>
  field.type === 'content' ? field.body.slice(0, 60) : field.label;

export function FieldList({
  section,
  currentId,
  flagged,
  onSelect,
  onAdd,
}: {
  section: Section;
  /** The selected question, or null when the section is selected. */
  currentId: string | null;
  flagged: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          {section.title === '' ? 'Untitled section' : section.title}
        </h2>
        {section.introduction !== undefined && (
          <p className="text-body text-muted">{section.introduction}</p>
        )}
      </div>
      <ol
        role="list"
        aria-label="Questions"
        className="flex flex-col divide-y divide-divider border-y border-divider"
      >
        {section.fields.map((field, index) => (
          <li key={field.id}>
            <button
              id={`outline-${field.id}`}
              type="button"
              aria-current={field.id === currentId ? 'true' : undefined}
              onClick={() => {
                onSelect(field.id);
              }}
              className={cx(selectable, 'gap-3 px-3 py-3')}
            >
              <span className="w-5 shrink-0 pt-0.5 text-sm text-muted tabular-nums">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium break-words text-ink">
                      {nameOf(field) === '' ? 'Untitled question' : nameOf(field)}
                    </span>
                    {flagged.has(field.id) && <ProblemTag />}
                  </span>
                  <span className="text-sm text-muted">{typeLabel(field.type)}</span>
                </span>
                <span className="text-sm text-muted">{notesOf(field)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Button id="add-question" className="self-start" onClick={onAdd}>
        <PlusIcon />
        Add question
      </Button>
    </div>
  );
}
