// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buttonClassName,
  EmptyState,
  Link,
  PageHeading,
  Tag,
  useCan,
  useParams,
} from '@pixel-scientists/ui';
import type { ButtonVariant } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { programmeStatuses } from '../../contracts/index.ts';
import type { ProgrammeStatus } from '../../contracts/index.ts';

/** A parameter of the page's address. The route has checked that it is an id. */
export function useParam(name: string): string {
  return useParams()[name] ?? '';
}

/** The page for someone who can set up programmes. Anyone else is told so, under the page's own title. */
export function ManagePage({ title, children }: { title: string; children: ReactNode }) {
  if (useCan('grants.programmes.manage')) {
    return <div className="flex flex-col gap-stack">{children}</div>;
  }
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>{title}</PageHeading>
      <EmptyState title="You cannot set up programmes">
        <p>Ask an administrator at your funder to give you the programme manager role.</p>
      </EmptyState>
    </div>
  );
}

const statusTones = { draft: 'neutral', open: 'info', closed: 'neutral' } as const;

export function StatusTag({ status }: { status: ProgrammeStatus }) {
  return <Tag tone={statusTones[status]}>{programmeStatuses[status]}</Tag>;
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
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
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
