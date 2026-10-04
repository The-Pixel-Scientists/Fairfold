// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form components in the component gallery, wired to the real form
// engine as the portal and the scoring workspace will wire them: the engine
// decides what is shown, checks the answers and builds each audience's view,
// and the components only draw the result. Development builds only.

import {
  canSee,
  checkEligibility,
  countCharacters,
  countWords,
  formDefinitionSchema,
  projectAnswers,
  validateAnswers,
  visibleFields,
} from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import { AnswerView, Button, EligibilityStop, FormSection, SaveStatus } from '@pixel-scientists/ui';
import type { FormHelpers } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

/** The engine's own counter and money format, so what people see is what the server checks. */
export const helpers: FormHelpers = { countWords, countCharacters, formatMoney };

const spendOptions = [
  { value: 'building', label: 'Building work' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'training', label: 'Training' },
];

/** One question of every type but file upload, with its ids starting `f_<prefix>`. */
function typeFields(prefix: string) {
  const id = (name: string) => `f_${prefix}${name}`;
  return [
    {
      id: id('intro'),
      type: 'content',
      body: 'Answer every question marked required.\n\nNothing you enter here is saved.',
    },
    {
      id: id('name'),
      type: 'short_text',
      label: 'Organisation name',
      required: true,
      maxCharacters: 60,
    },
    {
      id: id('story'),
      type: 'long_text',
      label: 'What will you do with the money?',
      hint: 'Say who it is for and what will change.',
      required: true,
      maxWords: 20,
    },
    {
      id: id('people'),
      type: 'number',
      label: 'How many people will take part?',
      required: true,
      wholeNumber: true,
      min: 1,
      max: 10_000,
    },
    {
      id: id('amount'),
      type: 'currency',
      label: 'How much are you asking for?',
      hint: 'Between £1,000 and £50,000.',
      required: true,
      minMinor: 100_000,
      maxMinor: 5_000_000,
    },
    { id: id('start'), type: 'date', label: 'When will the project start?', required: true },
    { id: id('email'), type: 'email', label: 'Contact email address', required: true },
    { id: id('phone'), type: 'phone', label: 'Contact phone number' },
    { id: id('site'), type: 'url', label: 'Website', hint: 'Start with https://' },
    {
      id: id('spend'),
      type: 'single_choice',
      label: 'What will the money pay for?',
      required: true,
      options: spendOptions,
    },
    {
      id: id('charity'),
      type: 'yes_no',
      label: 'Is your organisation a registered charity?',
      required: true,
    },
    {
      id: id('who'),
      type: 'multiple_choice',
      label: 'Who will take part?',
      required: true,
      options: [
        { value: 'young', label: 'Young people' },
        { value: 'older', label: 'Older people' },
        { value: 'families', label: 'Families' },
      ],
      minSelections: 1,
      maxSelections: 2,
    },
    {
      id: id('region'),
      type: 'dropdown',
      label: 'Which region will you work in?',
      options: [
        { value: 'north', label: 'North' },
        { value: 'south', label: 'South' },
      ],
    },
    { id: id('address'), type: 'uk_address', label: 'Organisation address', required: true },
  ];
}

function typesForm(prefix: string): FormDefinition {
  return formDefinitionSchema.parse({
    sections: [{ id: `s_${prefix}types`, title: 'About your project', fields: typeFields(prefix) }],
  });
}

const emptyForm = typesForm('e');
const problemForm = typesForm('p');

/** Answers that each break a different rule, for the form's problem states. */
const problemAnswers: Answers = {
  f_pname: 'Northfield Community Trust',
  f_pstory:
    'We will run weekly sessions in the hall for older people, with a hot meal, a quiz, a chance to meet neighbours and a lift home for everyone who needs one afterwards.',
  f_ppeople: 0,
  f_pamount: { amountMinor: 5000, currency: 'GBP' },
  f_pstart: '2027-02-31',
  f_pemail: 'ada@',
  f_pphone: '123',
  f_psite: 'http://northfield.example',
  f_pspend: 'building',
  f_pwho: ['young', 'older', 'families'],
  f_paddress: { line1: '1 High Street', town: '', postcode: 'XYZ' },
};

const conditionalForm = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_cabout',
      title: 'About the project',
      fields: [
        {
          id: 'f_cweb',
          type: 'yes_no',
          label: 'Does your organisation have a website?',
          required: true,
        },
        {
          id: 'f_cwebsite',
          type: 'url',
          label: 'Website address',
          required: true,
          conditions: [{ field: 'f_cweb', equals: true }],
        },
        {
          id: 'f_cspend',
          type: 'multiple_choice',
          label: 'What will the money pay for?',
          required: true,
          options: spendOptions,
        },
        {
          id: 'f_cworks',
          type: 'long_text',
          label: 'Describe the building work',
          required: true,
          maxWords: 50,
          conditions: [{ field: 'f_cspend', includes: 'building' }],
        },
      ],
    },
    {
      id: 's_cplanning',
      title: 'Planning permission',
      introduction: 'You only see this section if the money pays for building work.',
      conditions: [{ field: 'f_cspend', includes: 'building' }],
      fields: [
        {
          id: 'f_cplan',
          type: 'yes_no',
          label: 'Do you have planning permission?',
          required: true,
        },
      ],
    },
  ],
});

const eligibilityForm = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_gcheck',
      title: 'Before you start',
      introduction: 'Two questions to check this fund is right for you.',
      fields: [
        {
          id: 'f_gcharity',
          type: 'yes_no',
          label: 'Is your organisation a registered charity?',
          required: true,
          eligibility: {
            stopWhen: false,
            explanation: 'This fund is open to registered charities only.',
          },
        },
        {
          id: 'f_gspend',
          type: 'single_choice',
          label: 'What will the money pay for?',
          required: true,
          options: [...spendOptions, { value: 'loans', label: 'Paying off loans' }],
          eligibility: {
            stopValues: ['loans'],
            explanation: 'We cannot pay off loans or other debts.',
          },
        },
      ],
    },
  ],
});

const readingForm = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_vabout',
      title: 'About your organisation',
      fields: [
        {
          id: 'f_vname',
          type: 'short_text',
          label: 'Organisation name',
          required: true,
          identity: true,
        },
        {
          id: 'f_vemail',
          type: 'email',
          label: 'Contact email address',
          identity: true,
          audiences: ['applicant', 'staff'],
        },
        { id: 'f_vaddress', type: 'uk_address', label: 'Organisation address', identity: true },
        { id: 'f_vsite', type: 'url', label: 'Website' },
      ],
    },
    {
      id: 's_vproject',
      title: 'About your project',
      fields: [
        { id: 'f_vstory', type: 'long_text', label: 'What will you do with the money?' },
        { id: 'f_vamount', type: 'currency', label: 'How much are you asking for?' },
        { id: 'f_vstart', type: 'date', label: 'When will the project start?' },
        {
          id: 'f_vspend',
          type: 'single_choice',
          label: 'What will the money pay for?',
          options: spendOptions,
        },
        {
          id: 'f_vwho',
          type: 'multiple_choice',
          label: 'Who will take part?',
          options: [
            { value: 'young', label: 'Young people' },
            { value: 'older', label: 'Older people' },
          ],
        },
        { id: 'f_vpeople', type: 'number', label: 'How many people will take part?' },
      ],
    },
    {
      id: 's_vmonitor',
      title: 'Equality monitoring',
      fields: [
        {
          id: 'f_vgroup',
          type: 'single_choice',
          label: 'Which group best describes the people who lead your organisation?',
          audiences: 'aggregate_only',
          options: [
            { value: 'one', label: 'Group one' },
            { value: 'two', label: 'Group two' },
          ],
        },
      ],
    },
  ],
});

const readingAnswers: Answers = {
  f_vname: 'Northfield Community Trust',
  f_vemail: 'hello@northfield.example',
  f_vaddress: { line1: '1 High Street', town: 'Northfield', postcode: 'NF1 1AA' },
  f_vstory: 'We will run a weekly lunch club for older people.\nA minibus will bring people in.',
  f_vamount: { amountMinor: 1_500_000, currency: 'GBP' },
  f_vstart: '2027-04-01',
  f_vspend: 'equipment',
  f_vwho: ['young', 'older'],
  f_vgroup: 'two',
};

interface ExampleFormProps {
  definition: FormDefinition;
  initial?: Answers;
}

/** A form that keeps its answers and checks them when the person asks, as an apply journey will. */
function ExampleForm({ definition, initial = {} }: ExampleFormProps) {
  const [answers, setAnswers] = useState<Answers>(initial);
  const [problems, setProblems] = useState<readonly { field: string; message: string }[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [valid, setValid] = useState(false);

  const visible = visibleFields(definition, answers);
  const shown = new Set(visible.map((field) => field.id));
  const eligibility = checkEligibility(definition, answers);

  function change(fieldId: string, value: unknown) {
    // An answer to a question that is no longer shown would fail the check, so it goes.
    setAnswers(projectAnswers(definition, { ...answers, [fieldId]: value }, 'applicant'));
    setProblems((current) =>
      current.filter(({ field }) => field !== fieldId && !field.startsWith(`${fieldId}.`)),
    );
    setValid(false);
  }

  function check(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateAnswers(definition, answers, 'submit');
    setProblems(found);
    setValid(found.length === 0);
    setAttempt((count) => count + 1);
  }

  return (
    <form noValidate onSubmit={check} className="flex flex-col gap-stack">
      {definition.sections
        .filter((section) => section.fields.some((field) => shown.has(field.id)))
        .map((section) => (
          <FormSection
            key={section.id}
            section={section}
            visible={visible}
            answers={answers}
            problems={problems}
            attempt={attempt}
            onChange={change}
            helpers={helpers}
            headingLevel="h3"
          />
        ))}
      {eligibility.status === 'stopped' && (
        <EligibilityStop
          explanation={eligibility.explanation}
          fieldId={eligibility.fieldId}
          headingLevel="h3"
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {eligibility.status !== 'stopped' && (
          <Button type="submit" variant="primary">
            Check answers
          </Button>
        )}
        <p role="status" className="text-body text-success">
          {valid && 'Your answers are valid. Nothing was saved, because this is an example.'}
        </p>
      </div>
    </form>
  );
}

/** Every question type, with nothing answered: check the answers to see every required message. */
export function EmptyQuestionsExample() {
  return <ExampleForm definition={emptyForm} />;
}

/** Every question type, with answers that each break a rule, so each error and the count over its limit show. */
export function ProblemQuestionsExample() {
  return <ExampleForm definition={problemForm} initial={problemAnswers} />;
}

/** Questions and a section that come and go with earlier answers. */
export function ConditionalExample() {
  return <ExampleForm definition={conditionalForm} />;
}

/** Answers that stop an applicant, with what they are told and what they can do. */
export function EligibilityExample() {
  return <ExampleForm definition={eligibilityForm} />;
}

/** The same answers as two audiences see them: staff, and a blind reviewer, who never get identity fields. */
export function AnswerExample() {
  const views = [
    { name: 'Staff', audience: 'staff' },
    { name: 'Blind reviewer', audience: 'blind_reviewer' },
  ] as const;
  return (
    <div className="flex max-w-prose flex-col gap-stack">
      {views.map(({ name, audience }) => {
        const projected = projectAnswers(readingForm, readingAnswers, audience);
        const visible = visibleFields(readingForm, projected).filter((field) =>
          canSee(field, audience),
        );
        return (
          <div key={audience} className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-ink">{name}</h3>
            <AnswerView
              sections={readingForm.sections}
              visible={visible}
              answers={projected}
              helpers={helpers}
              headingLevel="h4"
            />
          </div>
        );
      })}
    </div>
  );
}

/** The three messages that save status shows, for the portal and the scoring workspace. */
export function SaveStatusExample() {
  return (
    <div className="flex flex-col gap-2">
      <SaveStatus state={{ status: 'saving' }} />
      <SaveStatus state={{ status: 'saved', at: new Date(2026, 9, 20, 14, 14) }} />
      <SaveStatus state={{ status: 'failed' }} />
    </div>
  );
}
