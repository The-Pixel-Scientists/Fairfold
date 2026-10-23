// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, PageHeading, useCan, useParams } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

/** A parameter of the page's address. The route has checked that it is an id. */
export function useParam(name: string): string {
  return useParams()[name] ?? '';
}

/** The page for someone who can assign reviewers. Anyone else is told so, under the page's own title. */
export function AssignPage({ title, children }: { title: string; children: ReactNode }) {
  if (useCan('grants.reviews.assign')) {
    return <div className="flex flex-col gap-stack">{children}</div>;
  }
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>{title}</PageHeading>
      <EmptyState title="You cannot manage reviewers">
        <p>Ask an administrator at your funder to give you the programme manager role.</p>
      </EmptyState>
    </div>
  );
}

/** The page for someone who can score. Anyone else is told so, under the page's own title. */
export function ScorePage({ title, children }: { title: string; children: ReactNode }) {
  if (useCan('grants.reviews.score')) {
    return <div className="flex flex-col gap-stack">{children}</div>;
  }
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>{title}</PageHeading>
      <EmptyState title="You cannot review applications">
        <p>Ask an administrator at your funder to give you the reviewer role.</p>
      </EmptyState>
    </div>
  );
}
