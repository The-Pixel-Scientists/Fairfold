// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of check your answers: every question read back with a way to change
// it, the budget and documents summarised, and the declarations before sending.
// The answers are the ones the console's previews show for NF-CG-0412.

import {
  Button,
  CheckboxGroup,
  ErrorSummary,
  Link,
  SummaryList,
  Tag,
  buttonClassName,
  useNavigate,
} from '@pixel-scientists/ui';
import type { FormMoney, QuestionDefinition, SummaryItem } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { answers, isShown, organisation, outcomes, project } from './form.ts';
import type { FormScreen } from './form.ts';
import { documents, fundingEvidence } from './journey.ts';
import { ChevronIcon, ScreenHeader, Section } from './parts.tsx';
import { application, budget, otherFunding, pounds, round, totalCost } from './story.ts';

const DECLARATION_ID = 'declarations';
const DECLARATION_ERROR = 'Tick every box to confirm your declarations';
const declarations = [
  { value: 'agreed', label: 'Our governing body has agreed to this application.' },
  { value: 'safeguarding', label: 'Our safeguarding policy was reviewed in the last 12 months.' },
  {
    value: 'correct',
    label:
      'The answers in this application are true, and I am allowed to apply for my organisation.',
  },
] as const;

/** An answer with a "Change" link that says, to a screen reader, which question it changes. */
function answer(term: string, value: ReactNode, to: string): SummaryItem {
  return {
    term,
    value,
    action: (
      <Link to={to}>
        Change <span className="sr-only">{term.toLowerCase().replace('?', '')}</span>
      </Link>
    ),
  };
}

function lines(...text: string[]): ReactNode {
  return text.map((line) => (
    <span key={line} className="block">
      {line}
    </span>
  ));
}

const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** An answer as the person reads it back. */
function display(field: QuestionDefinition, value: unknown): ReactNode {
  switch (field.type) {
    case 'yes_no':
      return value === true ? 'Yes' : 'No';
    case 'single_choice':
    case 'multiple_choice':
      return lines(
        ...field.options
          .filter((option) => [value].flat().includes(option.value))
          .map(({ label }) => label),
      );
    case 'uk_address':
      return lines(...Object.values(value as Record<string, string>));
    case 'date':
      return longDate.format(new Date(`${String(value)}T00:00`));
    case 'currency':
      return pounds((value as FormMoney).amountMinor / 100);
    default:
      return String(value);
  }
}

/** Every question the applicant is asked on a screen, each with a link to it. */
function questionsOf({ path, groups }: FormScreen): readonly SummaryItem[] {
  return groups
    .flatMap(({ fields }) => fields)
    .flatMap((field) =>
      field.type === 'content' || !isShown(field.id, answers)
        ? []
        : [answer(field.label, display(field, answers[field.id]), `${path}#${field.id}`)],
    );
}

/** The costs as a list, not a table, so each amount stays beside its name on a phone. */
function CostList() {
  return (
    <ul role="list" className="flex flex-col gap-3 pt-2">
      {budget.map((line) => (
        <li key={line.item} className="flex flex-col gap-0.5">
          <p className="flex items-baseline justify-between gap-4">
            <span className="font-medium">{line.item}</span>
            <span className="tabular-nums">{pounds(line.cost)}</span>
          </p>
          <p className="text-sm text-muted">{line.detail}</p>
        </li>
      ))}
      <li className="flex items-baseline justify-between gap-4 border-t border-divider pt-3 font-semibold">
        <span>Total cost of the project</span>
        <span className="tabular-nums">{pounds(totalCost)}</span>
      </li>
    </ul>
  );
}

function ready(fileName: string) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="break-words">{fileName}</span>
      <Tag tone="success">Ready</Tag>
    </span>
  );
}

const budgetItems: readonly SummaryItem[] = [
  answer(
    'Costs of the project',
    <div className="flex flex-col gap-2">
      <span>
        {pounds(totalCost)}, in {budget.length} costs
      </span>
      <details className="group">
        <summary className="inline-flex min-h-target cursor-pointer items-center gap-1.5 text-accent hover:text-accent-hover">
          <ChevronIcon className="size-3.5 transition-transform duration-(--motion-fast) group-open:rotate-90" />
          <span className="underline decoration-current/45 underline-offset-[0.22em]">
            Show the costs
          </span>
        </summary>
        <CostList />
      </details>
    </div>,
    '/application/budget#cost-0-item',
  ),
  answer(
    'Other funding',
    lines(...otherFunding.map(({ source, amount }) => `${pounds(amount)} from ${source}`)),
    '/application/budget#funding-0-source',
  ),
  answer(
    fundingEvidence.label,
    ready(fundingEvidence.file.name),
    `/application/budget#${fundingEvidence.id}`,
  ),
  {
    term: 'Amount you are asking for',
    value: <span className="font-semibold">{pounds(application.requested)}</span>,
  },
];

const documentItems: readonly SummaryItem[] = documents.map(({ id, label, file }) =>
  answer(label, ready(file.name), `/application/documents#${id}`),
);

const checked: readonly { title: string; items: readonly SummaryItem[] }[] = [
  { title: organisation.title, items: questionsOf(organisation) },
  { title: project.title, items: questionsOf(project) },
  { title: 'Budget', items: budgetItems },
  { title: outcomes.title, items: questionsOf(outcomes) },
  { title: 'Documents', items: documentItems },
];

export default function Check() {
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const incomplete = confirmed.length < declarations.length;
  const missing = attempts > 0 && incomplete;

  return (
    <PageColumn>
      {missing && (
        <ErrorSummary
          key={attempts}
          errors={[{ fieldId: DECLARATION_ID, message: DECLARATION_ERROR }]}
        />
      )}
      <ScreenHeader
        title="Check your answers"
        eyebrow={`${round.programme}, ${round.name}`}
        breadcrumbs={[
          { label: 'Your application', to: '/application' },
          { label: 'Check your answers' },
        ]}
      >
        <p>
          Read through your answers before you send them. You can change anything. We have saved
          every answer, so you will not lose them.
        </p>
      </ScreenHeader>

      <div className="flex flex-col gap-10">
        {checked.map(({ title, items }) => (
          <Section key={title} title={title}>
            <SummaryList items={items} />
          </Section>
        ))}
      </div>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (incomplete) setAttempts((count) => count + 1);
          else navigate('/application/submitted');
        }}
        className="flex flex-col gap-6 border-t border-divider pt-8"
      >
        <Section title="Declarations">
          <CheckboxGroup
            id={DECLARATION_ID}
            legend="Confirm before you send"
            name="declarations"
            values={confirmed}
            onValuesChange={setConfirmed}
            hint="We use your answers only to decide on this application and to run the fund."
            error={missing ? DECLARATION_ERROR : undefined}
            options={declarations}
          />
        </Section>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            Submit application
          </Button>
          <Link to="/application" className={buttonClassName('secondary', 'w-full sm:w-auto')}>
            Back to your application
          </Link>
        </div>
      </form>
    </PageColumn>
  );
}
