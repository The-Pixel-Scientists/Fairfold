// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pieces the privacy screens share: reading states, an action dialog with its
// error summary, and a list of choices.

import {
  Button,
  CheckboxGroup,
  Dialog,
  EmptyState,
  ErrorSummary,
  LoadingState,
  NotFoundPage,
  useSubmit,
} from '@pixel-scientists/ui';
import type { ButtonVariant } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { ProblemError } from '@pixel-scientists/domain/api';
import { useOnce } from './hooks.ts';
import type { Read } from './hooks.ts';

export interface ReadingProps<T> {
  state: Read<T>;
  /** Says what is loading, such as "Loading breaches". */
  label: string;
  retry: () => void;
  /** For a part of a page: a hidden record says so in place, rather than replacing the page. */
  inline?: boolean;
  children: (value: T) => ReactNode;
}

/** The loading state, why a read failed with a way to try again, the not-found page, or the content. */
export function Reading<T>({ state, label, retry, inline = false, children }: ReadingProps<T>) {
  switch (state.status) {
    case 'loading':
      return <LoadingState label={label} className="rounded-lg bg-surface" />;
    case 'notFound':
      return inline ? (
        <EmptyState title="Not available">
          <p>This is not here, or you cannot see it.</p>
        </EmptyState>
      ) : (
        <NotFoundPage />
      );
    case 'failed':
      return (
        <EmptyState
          title="We could not load this page"
          action={<Button onClick={retry}>Try again</Button>}
        >
          <p>{state.message}</p>
        </EmptyState>
      );
    case 'ready':
      return children(state.value);
  }
}

/** The options of a list of words, such as the kinds of request. */
export function Options({
  words,
  blank,
}: {
  words: Readonly<Record<string, string>>;
  blank?: string;
}) {
  return (
    <>
      {blank !== undefined && <option value="">{blank}</option>}
      {Object.entries(words).map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </>
  );
}

interface FormProps {
  fields: readonly string[];
  submit: string;
  variant: ButtonVariant;
  /** Sends the form. It closes the dialog itself once it has worked. */
  action: (data: FormData, idempotencyKey: string | undefined) => Promise<void>;
  onClose: () => void;
  children: (errorFor: (field: string) => string | undefined) => ReactNode;
}

function Form({ fields, submit, variant, action, onClose, children }: FormProps) {
  const once = useOnce();
  const { onSubmit, pending, errors, errorFor, attempt } = useSubmit(fields, (data) =>
    once((key) => action(data, key)),
  );
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <ErrorSummary key={attempt} errors={errors} />
      {children(errorFor)}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant={variant} aria-disabled={pending || undefined}>
          {submit}
        </Button>
      </div>
    </form>
  );
}

export interface ActionDialogProps extends Omit<FormProps, 'variant' | 'children'> {
  open: boolean;
  title: string;
  description?: ReactNode;
  variant?: ButtonVariant;
  wide?: boolean;
  children: FormProps['children'];
}

/**
 * A dialog around a form. It says what the button will do, shows what the
 * server refused in an error summary, and sends once however often the button
 * is pressed. The form starts afresh each time it opens.
 */
export function ActionDialog({
  open,
  title,
  description,
  wide,
  variant = 'primary',
  onClose,
  ...form
}: ActionDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
      wide={wide ?? false}
    >
      <Form {...form} variant={variant} onClose={onClose} />
    </Dialog>
  );
}

/** A mistake found before sending, shown like one the server found: against its field, in the error summary. */
export const refuse = (field: string, message: string): ProblemError =>
  new ProblemError(400, message, { errors: [{ field: `body.${field}`, message }] });

/** What a form field holds, or an empty string. */
export const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

interface ChoiceGroupProps {
  legend: string;
  /** Names the checkboxes and links the error summary to the first one. */
  name: string;
  options: readonly { value: string; label: string }[];
  initial?: readonly string[];
  hint?: string;
  error?: string | undefined;
}

/** Several choices from a checked list, sent with the form under `name`. */
export function ChoiceGroup({
  legend,
  name,
  options,
  initial = [],
  hint,
  error,
}: ChoiceGroupProps) {
  const [values, setValues] = useState<string[]>([...initial]);
  return (
    <CheckboxGroup
      legend={legend}
      id={name}
      name={name}
      values={values}
      onValuesChange={setValues}
      options={options}
      {...(hint === undefined ? {} : { hint })}
      error={error}
    />
  );
}

/** The strings a form sent under one name. */
export const texts = (data: FormData, name: string): string[] =>
  data.getAll(name).filter((value) => typeof value === 'string');
