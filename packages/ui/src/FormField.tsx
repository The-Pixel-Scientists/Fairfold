// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext, useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from './cx.ts';

/** What a form control needs from the field around it. */
export interface FormFieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

const FormFieldContext = createContext<FormFieldControlProps | null>(null);

/**
 * Props that tie a control to its field: the id the label points at, the hint
 * and error it is described by, and its invalid state. Returns null outside a
 * FormField, so a control still works on its own.
 */
export function useFormFieldControl(): FormFieldControlProps | null {
  return useContext(FormFieldContext);
}

export interface FormFieldProps {
  /** The question or name of the field. Keep it short and specific. */
  label: ReactNode;
  /** Help that applies before the person answers, such as a format or a limit. */
  hint?: ReactNode;
  /**
   * What went wrong and how to fix it, for example "Enter a date after 1 April 2027".
   * Leave it out when the field is valid.
   */
  error?: ReactNode;
  /** Adds "(optional)" to the label. Mark the optional fields, not the required ones. */
  optional?: boolean;
  /**
   * The control's id. Set it when something else links to the field, such as
   * an ErrorSummary; otherwise one is generated.
   */
  id?: string;
  className?: string;
  /** An Input, a Textarea or your own control that calls useFormFieldControl. */
  children: ReactNode;
}

function isPresent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/**
 * A label, optional hint, optional error and the control, wired together:
 * the label points at the control, and the control is described by the hint
 * and the error through aria-describedby.
 */
export function FormField({
  label,
  hint,
  error,
  optional = false,
  id,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const hasHint = isPresent(hint);
  const hasError = isPresent(error);
  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const control: FormFieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    'aria-invalid': hasError ? true : undefined,
  };

  return (
    <div
      className={cx(
        'flex flex-col gap-field-gap',
        hasError && 'border-l-4 border-danger pl-3',
        className,
      )}
    >
      <label htmlFor={controlId} className="text-body font-medium text-ink">
        {label}
        {optional && (
          <>
            {' '}
            <span className="font-normal text-muted">(optional)</span>
          </>
        )}
      </label>
      {hasHint && (
        <p id={hintId} className="text-body text-muted">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-body font-medium text-danger">
          <span className="sr-only">Error:</span> {error}
        </p>
      )}
      <FormFieldContext.Provider value={control}>{children}</FormFieldContext.Provider>
    </div>
  );
}

const controlClassName = [
  'block w-full min-h-control min-w-target rounded-md border border-edge bg-surface',
  'px-control-x py-1.5 text-body text-ink placeholder:text-muted',
  'aria-invalid:border-danger aria-invalid:shadow-[inset_0_0_0_1px_var(--color-danger)]',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted',
].join(' ');

/** Add the field's wiring to a control's own props. A description you pass yourself is kept. */
function withField<T extends { 'aria-describedby'?: string | undefined }>(
  props: T,
  field: FormFieldControlProps | null,
): T & Partial<FormFieldControlProps> {
  if (!field) return props;
  const describedBy = [props['aria-describedby'], field['aria-describedby']]
    .filter(Boolean)
    .join(' ');
  return {
    ...props,
    id: field.id,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    'aria-invalid': field['aria-invalid'],
  };
}

export type InputProps = ComponentProps<'input'>;

/**
 * A text input. Inside a FormField it takes the field's id, description and
 * invalid state. Set `type` and `autoComplete` to match what you are asking for.
 */
export function Input({ className, ...rest }: InputProps) {
  const field = useFormFieldControl();
  return <input {...withField(rest, field)} className={cx(controlClassName, className)} />;
}

export type TextareaProps = ComponentProps<'textarea'>;

/** A multi-line text input that takes the same wiring from its FormField as Input. */
export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  const field = useFormFieldControl();
  return (
    <textarea {...withField(rest, field)} rows={rows} className={cx(controlClassName, className)} />
  );
}

export type SelectProps = ComponentProps<'select'>;

/**
 * A drop-down list for choosing one of a fixed set of values, such as a time
 * zone. It is the browser's own, so it works with the keyboard, type-ahead and
 * assistive technology. Inside a FormField it takes the field's wiring, like Input.
 */
export function Select({ className, ...rest }: SelectProps) {
  const field = useFormFieldControl();
  return <select {...withField(rest, field)} className={cx(controlClassName, className)} />;
}
