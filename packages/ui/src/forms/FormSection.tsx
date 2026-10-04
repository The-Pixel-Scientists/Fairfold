// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FieldProblemLike } from '../auth/problems.ts';
import { ErrorSummary } from '../ErrorSummary.tsx';
import type { ErrorSummaryItem } from '../ErrorSummary.tsx';
import { PageHeading } from '../PageHeading.tsx';
import { ContentBlock, Question } from './Question.tsx';
import type { FormAnswers, FormHelpers, FormSectionDefinition, VisibleFields } from './types.ts';

export interface FormSectionProps {
  section: FormSectionDefinition;
  /** The fields shown for these answers: what `visibleFields()` returns for the whole form. */
  visible: VisibleFields;
  answers: FormAnswers;
  /** Called with the field's id and its new answer, or null when the person clears it. */
  onChange: (fieldId: string, value: unknown) => void;
  helpers: Pick<FormHelpers, 'countWords' | 'countCharacters'>;
  /**
   * What `validateAnswers()` found. Each message shows beside its field, and
   * in the summary once `attempt` is above zero. Pass problems when the
   * person asks to continue, not on every key, so errors do not appear while
   * they are still typing.
   */
  problems?: readonly FieldProblemLike[];
  /**
   * How many times the person has asked to continue. The summary of problems
   * shows from the first, and takes focus again on each.
   */
  attempt?: number;
  /** The section's heading level. An h1 is the page's heading and takes focus from the router. Defaults to h2. */
  headingLevel?: 'h1' | 'h2' | 'h3';
}

/** The id of the control a problem is about: `f_address.town` is the town box of `f_address`. */
function controlId(problemField: string): string {
  const [id = problemField, part] = problemField.split('.');
  return part === undefined || part === 'line1' ? id : `${id}-${part}`;
}

/**
 * One section of a form: its heading, its introduction and the fields that
 * are shown for the answers so far. Put it in a form that has `noValidate`,
 * so the engine's messages are the ones people see. The caller keeps the
 * answers, and the section never changes them except through `onChange`.
 */
export function FormSection({
  section,
  visible,
  answers,
  onChange,
  helpers,
  problems = [],
  attempt = 0,
  headingLevel: Heading = 'h2',
}: FormSectionProps) {
  const shown = new Set(visible.map((field) => field.id));
  const fields = section.fields.filter((field) => shown.has(field.id));
  const problemsFor = (id: string) =>
    problems.filter((problem) => problem.field === id || problem.field.startsWith(`${id}.`));

  const summary: ErrorSummaryItem[] = fields.flatMap((field) =>
    field.type === 'content'
      ? []
      : problemsFor(field.id).map((problem) => ({
          fieldId: controlId(problem.field),
          message: problem.message,
        })),
  );

  return (
    <div className="flex max-w-prose flex-col gap-stack">
      <div className="flex flex-col gap-2">
        {Heading === 'h1' ? (
          <PageHeading>{section.title}</PageHeading>
        ) : (
          <Heading className="text-xl font-semibold text-ink">{section.title}</Heading>
        )}
        {section.introduction !== undefined && (
          <p className="text-body text-muted">{section.introduction}</p>
        )}
      </div>
      {attempt > 0 && <ErrorSummary key={attempt} errors={summary} />}
      {fields.map((field) =>
        field.type === 'content' ? (
          <ContentBlock key={field.id} body={field.body} />
        ) : (
          <Question
            key={field.id}
            field={field}
            value={Object.hasOwn(answers, field.id) ? answers[field.id] : null}
            problems={problemsFor(field.id)}
            onChange={(value) => {
              onChange(field.id, value);
            }}
            helpers={helpers}
          />
        ),
      )}
    </div>
  );
}
