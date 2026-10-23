// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, PageHeading, useCan } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

interface GateProps {
  permission: 'grants.decisions.record' | 'grants.decisions.release';
  title: string;
  /** What the page is called, shown above the explanation to someone who may not use it. */
  heading: string;
  children: ReactNode;
}

/** A decision page for someone who holds the permission. Anyone else is told so, under the page's own title. */
export function Gate({ permission, title, heading, children }: GateProps) {
  if (useCan(permission)) return <div className="flex flex-col gap-stack">{children}</div>;
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>{heading}</PageHeading>
      <EmptyState title={title}>
        <p>Ask an administrator at your funder to give you the programme manager role.</p>
      </EmptyState>
    </div>
  );
}
