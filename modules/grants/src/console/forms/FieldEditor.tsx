// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The settings of the selected question: what every question has, then what
// its type adds. It changes nothing itself; each edit gives the whole new
// question to `onChange`.

import type { FormField, Question } from '@pixel-scientists/domain/forms';
import {
  CheckboxGroup,
  FormField as Field,
  Input,
  Panel,
  Select,
  Textarea,
} from '@pixel-scientists/ui';

import { Arrange } from './Arrange.tsx';
import { Choices } from './Choices.tsx';
import { Conditions } from './Conditions.tsx';
import { withType } from './draft.ts';
import { Eligibility } from './Eligibility.tsx';
import { Limit, Settings } from './Settings.tsx';
import type { Errors } from './Settings.tsx';
import { questionTypes, viewingOf, viewings } from './words.ts';

export interface FieldEditorProps {
  field: FormField;
  /** The questions before this one that a condition can read. */
  sources: readonly Question[];
  /** Where it sits in its section, from 0, and how many questions the section has. */
  position: number;
  count: number;
  /** The section's title, for "Question 1 of 3 in Budget". */
  section: string;
  errors: Errors;
  onChange: (field: FormField) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** Who sees the answer once the application is in, and whether blind reviewers are kept from it. */
function Visibility({
  question,
  errors,
  onChange,
}: {
  question: Question;
  errors: Errors;
  onChange: (question: Question) => void;
}) {
  const viewing = viewingOf(question.audiences);
  return (
    <Settings heading="Privacy">
      <Field
        id="field-audiences"
        label="Who sees the answer"
        hint={`The applicant always sees their own answer. ${viewing.hint}`}
        error={errors.get('audiences')}
      >
        <Select
          value={viewing.value}
          onChange={(event) => {
            const next = viewings.find((item) => item.value === event.currentTarget.value);
            if (next === undefined) return;
            onChange({
              ...question,
              audiences: Array.isArray(next.audiences) ? [...next.audiences] : next.audiences,
            });
          }}
        >
          {viewings.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>
      <CheckboxGroup
        id="field-identity"
        legend="Blind review"
        name="identity"
        values={question.identity ? ['identity'] : []}
        onValuesChange={(values) => {
          onChange({ ...question, identity: values.includes('identity') });
        }}
        options={[{ value: 'identity', label: 'Identity field: hide from blind reviewers' }]}
        hint="Tick this for answers that name or identify the applicant, such as a name, address or contact details."
      />
    </Settings>
  );
}

function TypeSettings({
  question,
  errors,
  onChange,
}: {
  question: Question;
  errors: Errors;
  onChange: (question: Question) => void;
}) {
  if (question.type === 'short_text' || question.type === 'long_text') {
    return (
      <Settings heading="Limits">
        <div className="grid grid-cols-2 gap-3">
          <Limit
            id="field-maxWords"
            label="Word limit"
            value={question.maxWords}
            error={errors.get('maxWords')}
            onChange={(maxWords) => {
              onChange({ ...question, maxWords });
            }}
          />
          <Limit
            id="field-maxCharacters"
            label="Character limit"
            value={question.maxCharacters}
            error={errors.get('maxCharacters')}
            onChange={(maxCharacters) => {
              onChange({ ...question, maxCharacters });
            }}
          />
        </div>
      </Settings>
    );
  }
  if (
    question.type === 'single_choice' ||
    question.type === 'dropdown' ||
    question.type === 'multiple_choice'
  ) {
    return <Choices question={question} errors={errors} onChange={onChange} />;
  }
  return null;
}

/** What the builder cannot change about a type of question yet, so a person is not left looking for it. */
const notEditable = 'You cannot change the settings of this type of question here yet.';

export function FieldEditor({
  field,
  sources,
  position,
  count,
  section,
  errors,
  onChange,
  onMove,
  onRemove,
}: FieldEditorProps) {
  const arrange = (name: string) => (
    <Arrange
      name={name}
      position={position}
      count={count}
      keepsOne="A section keeps at least one question. Add another before you remove this one."
      onMove={onMove}
      onRemove={onRemove}
    />
  );
  const where = (
    <p className="-mt-2 text-sm text-muted">
      Question {position + 1} of {count} in {section === '' ? 'this section' : section}
    </p>
  );

  if (field.type === 'content') {
    return (
      <Panel title="Edit text">
        {where}
        <Field id="field-body" label="Text" error={errors.get('body')}>
          <Textarea
            rows={6}
            value={field.body}
            onChange={(event) => {
              onChange({ ...field, body: event.currentTarget.value });
            }}
          />
        </Field>
        <Conditions field={field} sources={sources} errors={errors} onChange={onChange} />
        {arrange('this text')}
      </Panel>
    );
  }

  const editable = questionTypes.some(({ value }) => value === field.type);
  const note = questionTypes.find(({ value }) => value === field.type)?.note;
  return (
    <Panel title="Edit question">
      {where}
      <Field id="field-label" label="Question" error={errors.get('label')}>
        <Input
          value={field.label}
          autoComplete="off"
          onChange={(event) => {
            onChange({ ...field, label: event.currentTarget.value });
          }}
        />
      </Field>
      <Field id="field-hint" label="Hint" optional error={errors.get('hint')}>
        <Textarea
          rows={2}
          value={field.hint ?? ''}
          onChange={(event) => {
            const hint = event.currentTarget.value;
            onChange({ ...field, hint: hint === '' ? undefined : hint });
          }}
        />
      </Field>
      {editable ? (
        <Field id="field-type" label="Type" hint={note} error={errors.get('type')}>
          <Select
            value={field.type}
            onChange={(event) => {
              const type = questionTypes.find(({ value }) => value === event.currentTarget.value);
              if (type !== undefined) onChange(withType(field, type.value));
            }}
          >
            {questionTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-body text-muted">{notEditable}</p>
      )}
      <CheckboxGroup
        id="field-required"
        legend="Required"
        name="required"
        values={field.required ? ['required'] : []}
        onValuesChange={(values) => {
          onChange({ ...field, required: values.includes('required') });
        }}
        options={[{ value: 'required', label: 'Applicants must answer this question' }]}
        error={errors.get('required')}
      />
      <TypeSettings question={field} errors={errors} onChange={onChange} />
      <Visibility question={field} errors={errors} onChange={onChange} />
      <Conditions field={field} sources={sources} errors={errors} onChange={onChange} />
      {(field.type === 'yes_no' || field.type === 'single_choice') && (
        <Eligibility question={field} errors={errors} onChange={onChange} />
      )}
      {arrange(field.label === '' ? 'this question' : field.label)}
    </Panel>
  );
}
