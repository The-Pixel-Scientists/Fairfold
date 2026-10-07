// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  cx,
  CheckboxGroup,
  FileDrop,
  FormField,
  Input,
  Panel,
  RadioGroup,
  Textarea,
} from '@pixel-scientists/ui';

import type { FormQuestion } from './formData.ts';

const noop = () => undefined;

const amountOf = (text: string): number => Number(text.replace(/\D/g, ''));

const box =
  'block min-h-control rounded-md border border-edge bg-surface px-control-x py-1.5 text-body text-ink';

/**
 * The budget as a table with a heading row. Below sm each row stacks, with
 * every cell labelled by its heading, as the portal shows it on a phone.
 */
function BudgetTable({ question }: { question: FormQuestion }) {
  const costColumn = question.columns.findIndex((column) => column.kind === 'currency');
  const total = question.sample.reduce((sum, row) => sum + amountOf(row[costColumn] ?? ''), 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body font-medium text-ink">
        {question.label}
        {!question.required && <span className="font-normal text-muted"> (optional)</span>}
      </p>
      {question.hint !== '' && <p className="text-body text-muted">{question.hint}</p>}
      <table className="w-full border-collapse text-body max-sm:block">
        <thead className="max-sm:sr-only">
          <tr>
            {question.columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={cx(
                  'px-1 pb-1 text-sm font-medium text-muted',
                  column.kind === 'currency' ? 'text-end' : 'text-start',
                )}
              >
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {question.sample.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:border-t max-sm:border-divider max-sm:py-3 max-sm:first:border-t-0 max-sm:first:pt-0"
            >
              {question.columns.map((column, index) => (
                <td
                  key={index}
                  data-label={column.heading}
                  className={cx(
                    'px-1 py-1 align-top',
                    'max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:p-0 max-sm:before:text-sm max-sm:before:font-medium max-sm:before:text-muted max-sm:before:content-[attr(data-label)]',
                    column.kind === 'currency' && 'w-36',
                  )}
                >
                  <span className={cx(box, column.kind === 'currency' && 'text-end tabular-nums')}>
                    {row[index]}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {question.showTotal && costColumn >= 0 && (
          <tfoot className="max-sm:block">
            <tr className="max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:border-t max-sm:border-divider max-sm:pt-3">
              <th
                scope="row"
                colSpan={Math.max(costColumn, 1)}
                className="px-1 pt-2 text-end text-body font-medium text-ink max-sm:p-0"
              >
                {question.totalLabel}
              </th>
              <td className="px-1 pt-2 text-end font-semibold text-ink tabular-nums max-sm:p-0">
                £{total.toLocaleString('en-GB')}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      <Button className="self-start">{question.addLabel}</Button>
    </div>
  );
}

function Control({ question }: { question: FormQuestion }) {
  const field = {
    label: question.label,
    hint: question.hint === '' ? undefined : question.hint,
    optional: !question.required,
  };
  const options = question.options
    .split('\n')
    .filter(Boolean)
    .map((option) => ({ value: option, label: option }));

  switch (question.type) {
    case 'long_text':
      return (
        <FormField {...field}>
          <Textarea rows={4} readOnly />
          <p className="text-body text-muted">You have {question.wordLimit} words left</p>
        </FormField>
      );
    case 'currency':
      return (
        <FormField {...field}>
          <div className="flex items-center gap-2">
            <span aria-hidden="true">£</span>
            <Input readOnly className="max-w-48" />
          </div>
        </FormField>
      );
    case 'yes_no':
      return (
        <RadioGroup
          legend={question.label}
          hint={field.hint}
          name="preview-yes-no"
          value=""
          onValueChange={noop}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
      );
    case 'choice':
      return question.multiple ? (
        <CheckboxGroup
          legend={question.label}
          hint={field.hint}
          name="preview-choice"
          values={[]}
          onValuesChange={noop}
          options={options}
        />
      ) : (
        <RadioGroup
          legend={question.label}
          hint={field.hint}
          name="preview-choice"
          value=""
          onValueChange={noop}
          options={options}
        />
      );
    case 'budget_table':
      return <BudgetTable question={question} />;
    case 'file_upload':
      return (
        <FileDrop
          label={question.label}
          hint={[
            question.hint,
            `${question.accept.join(' or ')}, up to ${String(question.maxSizeMb)} MB.`,
          ]
            .filter(Boolean)
            .join(' ')}
          multiple={question.maxFiles > 1}
          files={[]}
        />
      );
    case 'confirmation':
      return (
        <CheckboxGroup
          legend="Declaration"
          name="preview-confirmation"
          values={[]}
          onValuesChange={noop}
          options={[{ value: 'agree', label: question.label }]}
        />
      );
    case 'date':
      return (
        <FormField {...field}>
          <Input readOnly placeholder="Day, month and year" className="max-w-48" />
        </FormField>
      );
    case 'short_text':
    case 'email':
    case 'number':
      return (
        <FormField {...field}>
          <Input readOnly className={question.type === 'number' ? 'max-w-48' : undefined} />
        </FormField>
      );
  }
}

/** The selected question as an applicant sees it. It is for looking at: nothing in it takes focus. */
export function QuestionPreview({ question }: { question: FormQuestion }) {
  return (
    <Panel title="How applicants see it">
      <p className="-mt-2 text-sm text-muted">
        A picture of this question as applicants see it. Use Preview form to try the whole form.
      </p>
      <div inert aria-hidden="true" className="max-w-xl">
        <Control question={question} />
      </div>
    </Panel>
  );
}
