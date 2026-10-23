// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, PageHeading, useCan } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

/** The page for someone who can read submissions. Anyone else is told so, under the page's own title. */
export function ReadPage({ title, children }: { title: string; children: ReactNode }) {
  if (useCan('grants.applications.read')) {
    return <div className="flex flex-col gap-stack">{children}</div>;
  }
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>{title}</PageHeading>
      <EmptyState title="You cannot view submissions">
        <p>Ask an administrator at your funder to give you the programme manager role.</p>
      </EmptyState>
    </div>
  );
}
