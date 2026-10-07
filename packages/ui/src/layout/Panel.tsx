// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from '../cx.ts';

export interface PanelProps {
  /** Names the panel. A titled panel is a labelled section. */
  title?: string;
  /** The heading level, so the panel fits the page's outline. Defaults to h2. */
  headingLevel?: 'h2' | 'h3';
  /** Controls for the panel as a whole, at the end of the title row. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A bordered section for a group of related content, such as the activity on
 * an application. The hairline border carries it, so it reads as a sheet on
 * the canvas and inside the console's sheet, where the surface is the same colour.
 */
export function Panel({
  title,
  headingLevel: Heading = 'h2',
  actions,
  children,
  className,
}: PanelProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title === undefined ? undefined : titleId}
      className={cx(
        'flex min-w-0 flex-col gap-4 rounded-lg border border-divider bg-surface p-gutter',
        className,
      )}
    >
      {(title !== undefined || actions) && (
        <div className="flex min-h-control flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {title !== undefined && (
            <Heading id={titleId} className="text-lg font-semibold tracking-tight text-ink">
              {title}
            </Heading>
          )}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
