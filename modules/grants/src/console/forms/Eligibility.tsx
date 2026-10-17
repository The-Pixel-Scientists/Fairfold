// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Question } from '@pixel-scientists/domain/forms';
import { CheckboxGroup, FormField, RadioGroup, Textarea } from '@pixel-scientists/ui';

import { Settings } from './Settings.tsx';
import type { Errors } from './Settings.tsx';

type YesNo = Extract<Question, { type: 'yes_no' }>;
type SingleChoice = Extract<Question, { type: 'single_choice' }>;
export type EligibilityQuestion = YesNo | SingleChoice;

interface Props<T> {
  question: T;
  errors: Errors;
  onChange: (question: T) => void;
}

/**
 * An eligibility question must be required and seen by staff, so a question
 * that stops applicants becomes both: staff are added to who sees the answer,
 * and nobody else is taken away.
 */
function eligible(question: Question) {
  const { audiences } = question;
  return {
    required: true,
    audiences:
      Array.isArray(audiences) && audiences.includes('staff')
        ? audiences
        : [...(Array.isArray(audiences) ? audiences : ['applicant' as const]), 'staff' as const],
  };
}

/** The words an applicant is told when an answer stops them, which the manager writes. */
function Explanation({
  explanation,
  error,
  onChange,
}: {
  explanation: string;
  error: string | undefined;
  onChange: (explanation: string) => void;
}) {
  return (
    <FormField
      id="field-eligibility-explanation"
      label="What applicants are told"
      hint="Say why they cannot apply and what they could do instead."
      error={error}
    >
      <Textarea
        rows={3}
        value={explanation}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
    </FormField>
  );
}

function StopOnYesOrNo({ question, errors, onChange }: Props<YesNo>) {
  const { eligibility } = question;
  const stop = (stopWhen: boolean, explanation: string) => {
    onChange({ ...question, ...eligible(question), eligibility: { stopWhen, explanation } });
  };
  return (
    <>
      <RadioGroup
        id="field-eligibility"
        legend="Stop applicants who answer…"
        name="eligibility"
        value={eligibility === undefined ? 'nobody' : eligibility.stopWhen ? 'yes' : 'no'}
        error={errors.get('eligibility')}
        onValueChange={(value) => {
          if (value === 'nobody') onChange({ ...question, eligibility: undefined });
          else stop(value === 'yes', eligibility?.explanation ?? '');
        }}
        options={[
          { value: 'nobody', label: 'Nobody. Every answer can go on' },
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
      {eligibility !== undefined && (
        <Explanation
          explanation={eligibility.explanation}
          error={errors.get('eligibility.explanation')}
          onChange={(explanation) => {
            stop(eligibility.stopWhen, explanation);
          }}
        />
      )}
    </>
  );
}

function StopOnChoices({ question, errors, onChange }: Props<SingleChoice>) {
  const { eligibility } = question;
  const stop = (stopValues: string[], explanation: string) => {
    onChange({ ...question, ...eligible(question), eligibility: { stopValues, explanation } });
  };
  return (
    <>
      <CheckboxGroup
        id="field-eligibility"
        legend="Stop applicants who answer…"
        name="eligibility"
        hint="Leave at least one choice that lets applicants go on."
        error={errors.get('eligibility')}
        values={eligibility?.stopValues ?? []}
        onValuesChange={(stopValues) => {
          if (stopValues.length === 0) onChange({ ...question, eligibility: undefined });
          else stop(stopValues, eligibility?.explanation ?? '');
        }}
        options={question.options.map((choice, index) => ({
          value: choice.value,
          label: choice.label === '' ? `Choice ${String(index + 1)}` : choice.label,
        }))}
      />
      {eligibility !== undefined && (
        <Explanation
          explanation={eligibility.explanation}
          error={errors.get('eligibility.explanation')}
          onChange={(explanation) => {
            stop(eligibility.stopValues, explanation);
          }}
        />
      )}
    </>
  );
}

/** Which answers end an application, and what the applicant is told. */
export function Eligibility(props: Props<EligibilityQuestion>) {
  const { question } = props;
  return (
    <Settings heading="Eligibility">
      {question.type === 'yes_no' ? (
        <StopOnYesOrNo {...props} question={question} />
      ) : (
        <StopOnChoices {...props} question={question} />
      )}
    </Settings>
  );
}
