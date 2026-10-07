// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, PageHeader, Tag, cx } from '@pixel-scientists/ui';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { tabLinkClassName } from '../../shell/navLink.ts';

const screens = [
  { to: '/insight', label: 'Round dashboard' },
  { to: '/insight/equality', label: 'Equality monitoring' },
  { to: '/insight/geography', label: 'Where the money goes' },
  { to: '/insight/reviewers', label: 'Reviewer calibration' },
  { to: '/insight/warehouse', label: 'Data warehouse' },
] as const;

export interface InsightFrameProps {
  /** The programme and round the page is about, beside the "Design preview" tag. */
  context?: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** The start of every Insight page: the header, the pages of the section, then the page. */
export function InsightFrame({
  context = 'Community Grants, Spring 2027',
  title,
  description,
  actions,
  children,
}: InsightFrameProps) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-current]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <>
            <Tag tone="info">Design preview</Tag>
            <span>{context}</span>
          </>
        }
        title={title}
        description={description}
        actions={actions}
      >
        <nav aria-label="Insight" className="mt-2">
          <div
            ref={strip}
            className="-mx-2 -mt-2 -mb-1.5 overflow-x-auto px-2 pt-2 pb-1.5 motion-safe:scroll-smooth"
          >
            <ul role="list" className="flex w-max min-w-full gap-x-6 border-b border-divider pb-px">
              {screens.map((screen) => (
                <li key={screen.to}>
                  <Link to={screen.to} className={cx(tabLinkClassName, 'whitespace-nowrap')}>
                    {screen.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </PageHeader>
      {children}
    </div>
  );
}
