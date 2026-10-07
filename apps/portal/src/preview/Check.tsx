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
import type { SummaryItem } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { documents, fundingEvidence } from './journey.ts';
import { ChevronIcon, ScreenHeader, Section } from './parts.tsx';
import { application, applicant, budget, otherFunding, pounds, round, totalCost } from './story.ts';

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
function answer(term: string, value: ReactNode, to = '/application'): SummaryItem {
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

const organisation: readonly SummaryItem[] = [
  answer('Organisation name', applicant.organisation),
  answer('Registered charity', 'Yes'),
  answer('Registered charity number', applicant.charityNumber),
  answer('Address', lines(...applicant.address.split(', '))),
  answer('Main contact name', applicant.name),
  answer('Main contact email', applicant.email),
  answer('Main contact phone', applicant.phone),
  answer('Income last year', '£184,200'),
  answer('Paid staff and regular volunteers', '44'),
  answer('Who leads your organisation?', 'Led by women'),
];

const project: readonly SummaryItem[] = [
  answer('Project name', application.project),
  answer(
    'Project summary',
    'A hot three-course lunch every Tuesday at Riverside Hall for people aged 65 and over who live alone.',
  ),
  answer(
    'Why it is needed',
    'Northfield Central has more older people living alone than anywhere else in the county. In our 2026 survey of 112 residents aged 65 and over, 6 in 10 said they eat their main meal alone most days, and 4 in 10 had not left home on at least three days that week. Our Tuesday coffee morning is always full, and 23 people are waiting for a lunch place that does not exist yet.',
  ),
  answer(
    'What you will do',
    'From 1 June 2027 we will serve a hot three-course lunch for up to 40 people every Tuesday for 48 weeks. A paid cook leads a rota of eight trained volunteers. A minibus brings 12 people who cannot get to the hall. After lunch there is something optional to join: a quiz, gentle exercise, or a visit from an adviser on benefits and health services.',
  ),
  answer('Start date', '1 June 2027'),
  answer('End date', '25 April 2028'),
  answer('Where it will take place', 'Riverside Hall, Mill Lane, Northfield'),
  answer('Which areas will it serve?', 'Northfield Central'),
  answer('Who will benefit most from your project?', lines('Older people', 'Disabled people')),
];

const outcomes: readonly SummaryItem[] = [
  answer(
    'What will change',
    'People will eat a hot meal with company at least once a week, make friends, and hear about benefits and health services they may be missing. We expect most regular guests to tell us they feel less lonely after six months.',
  ),
  answer('How many people will take part?', '120'),
  answer(
    'How will the people taking part help to shape it?',
    'Guests chose the format in our 2026 survey, and four of them will join a planning group that meets once a month to choose the menus and activities.',
  ),
  answer(
    'How you will know',
    'We will ask guests to complete a short loneliness scale when they join and again after six months, and keep a register of who comes. We will report numbers, the change in scores and three guest stories at the end of the grant.',
  ),
];

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
    '/application/budget',
  ),
  answer(
    'Other funding',
    lines(...otherFunding.map(({ source, amount }) => `${pounds(amount)} from ${source}`)),
    '/application/budget',
  ),
  answer(fundingEvidence.label, ready(fundingEvidence.file.name), '/application/budget'),
  {
    term: 'Amount you are asking for',
    value: <span className="font-semibold">{pounds(application.requested)}</span>,
  },
];

const documentItems: readonly SummaryItem[] = documents.map(({ label, file }) =>
  answer(label, ready(file.name), '/application/documents'),
);

const checked: readonly { title: string; items: readonly SummaryItem[] }[] = [
  { title: 'About your organisation', items: organisation },
  { title: 'Your project', items: project },
  { title: 'Budget', items: budgetItems },
  { title: 'Outcomes', items: outcomes },
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
