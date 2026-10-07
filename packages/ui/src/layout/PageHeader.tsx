// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { PageHeading } from '../PageHeading.tsx';
import { Breadcrumbs } from './Breadcrumbs.tsx';
import type { BreadcrumbItem } from './Breadcrumbs.tsx';

export interface PageHeaderProps {
  /** The page's name. It becomes the page's one h1. */
  title: string;
  /** A sentence on what the page is for or what state it is in. */
  description?: ReactNode;
  /** Small text above the title, such as the round or a Tag. */
  eyebrow?: ReactNode;
  breadcrumbs?: readonly BreadcrumbItem[];
  /** The page's actions, with at most one primary. They sit beside the title, and wrap below it on narrow screens. */
  actions?: ReactNode;
  /** Anything under the header, such as Tabs. */
  children?: ReactNode;
}

/** How a page starts: breadcrumbs, then the title with its description and actions, then anything else. */
export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-1.5">
        {eyebrow && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">{eyebrow}</div>
        )}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
            <PageHeading>{title}</PageHeading>
            {description && <div className="max-w-prose text-body text-muted">{description}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
