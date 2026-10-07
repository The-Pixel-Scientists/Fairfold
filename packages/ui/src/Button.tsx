// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentProps } from 'react';

import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet';

const base = [
  'inline-flex min-h-control min-w-target items-center justify-center gap-2',
  'rounded-md border px-control-x text-body font-medium no-underline',
  'transition-[background-color,border-color,color,box-shadow] duration-(--motion-fast) ease-standard',
  'active:translate-y-px',
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0',
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:active:translate-y-0',
].join(' ');

const variants: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-accent text-on-accent shadow-(--shadow-raised) hover:bg-accent-hover hover:text-on-accent',
  secondary:
    'border-edge bg-surface text-ink shadow-(--shadow-raised) hover:border-ink hover:bg-sunken hover:text-ink',
  danger:
    'border-transparent bg-danger text-on-danger shadow-(--shadow-raised) hover:bg-danger-hover hover:text-on-danger',
  quiet: 'border-transparent bg-transparent text-accent hover:bg-accent-soft hover:text-accent',
};

/** Class names for anything that should look like a button, such as a link. */
export function buttonClassName(variant: ButtonVariant = 'secondary', className?: string): string {
  return cx(base, variants[variant], className);
}

export interface ButtonProps extends ComponentProps<'button'> {
  /** Primary for the one main action on a page; danger for actions that cannot be undone. */
  variant?: ButtonVariant;
}

/**
 * A button that says what happens ("Save changes", not "Submit"). It never
 * submits a form unless you set type="submit".
 */
export function Button({
  variant = 'secondary',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return <button {...rest} type={type} className={buttonClassName(variant, className)} />;
}
