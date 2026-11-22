// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Permission } from '@pixel-scientists/domain/platform';
import {
  Button,
  buttonClassName,
  Dialog,
  EmptyState,
  ErrorSummary,
  Link,
  PageHeading,
  useCan,
  useSubmit,
  useParams,
} from '@pixel-scientists/ui';
import type { ButtonVariant, UseSubmit } from '@pixel-scientists/ui';
import { useId } from 'react';
import type { ReactNode } from 'react';

/** A parameter of the page's address. The route has checked that it is an id. */
export function useParam(name: string): string {
  return useParams()[name] ?? '';
}

const denied = {
  'impact.frameworks.read': {
    title: 'You cannot see outcomes',
    advice: 'Ask an administrator at your funder to give you access to Impact.',
  },
  'impact.frameworks.manage': {
    title: 'You cannot set up outcomes',
    advice: 'Ask an administrator at your funder to let you set up outcomes frameworks.',
  },
} as const;

/** The page for someone who holds `permission`. Anyone else is told so, under the page's own title. */
export function Gate({
  permission,
  title,
  children,
}: {
  permission: keyof typeof denied;
  title: string;
  children: ReactNode;
}) {
  if (useCan(permission)) return <div className="flex flex-col gap-stack">{children}</div>;
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>{title}</PageHeading>
      <EmptyState title={denied[permission].title}>
        <p>{denied[permission].advice}</p>
      </EmptyState>
    </div>
  );
}

/** Whether the member holds the permission and the framework still takes changes. */
export function useCanChange(permission: Permission, archived: boolean): boolean {
  const held = useCan(permission);
  return held && !archived;
}

/** A link that looks like a button, for going to another page. */
export function LinkButton({
  to,
  variant = 'secondary',
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClassName(variant)}>
      {children}
    </Link>
  );
}

/** A heading over a table or list, so heading navigation finds it, with an action for the whole section beside it. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** For a value a row does not have yet. A screen reader hears "None", not a dash. */
export function None() {
  return (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">None</span>
    </>
  );
}

/**
 * A dialog around a form. Problems with a field go in the error summary and
 * beside the field; without fields (a confirmation) the problem is said
 * under the question. Focus goes to the problem.
 */
export function FormDialog({
  title,
  description,
  submit,
  tone = 'primary',
  form,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** What the button does, such as "Save target". */
  submit: string;
  tone?: 'primary' | 'danger';
  form: UseSubmit;
  onClose: () => void;
  children?: ReactNode;
}) {
  const formId = useId();
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      {...(description === undefined ? {} : { description })}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form={formId}
            variant={tone}
            aria-disabled={form.pending || undefined}
          >
            {submit}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        {children === undefined ? (
          form.errors[0] && (
            <p role="alert" className="text-body font-medium text-danger">
              {form.errors[0].message}
            </p>
          )
        ) : (
          <ErrorSummary key={form.attempt} errors={form.errors} />
        )}
        {children}
      </form>
    </Dialog>
  );
}

/** Asks before something is removed. `action` removes it; the page closes the dialog and reloads. */
export function RemoveDialog({
  title,
  description,
  submit,
  action,
  onClose,
}: {
  title: string;
  description: ReactNode;
  submit: string;
  action: () => Promise<void>;
  onClose: () => void;
}) {
  const form = useSubmit([], action);
  return (
    <FormDialog
      title={title}
      description={description}
      submit={submit}
      tone="danger"
      form={form}
      onClose={onClose}
    />
  );
}

/** A button in a table row. Its name says what it acts on, so a screen reader reads it alone. */
export function RowButton({
  label,
  target,
  onClick,
}: {
  label: string;
  target: string;
  onClick: () => void;
}) {
  return (
    <Button variant="quiet" onClick={onClick}>
      {label} <span className="sr-only">{target}</span>
    </Button>
  );
}
