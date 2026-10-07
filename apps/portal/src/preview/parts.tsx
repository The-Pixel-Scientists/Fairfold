// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The few pieces the applying previews share: a header that marks the screen
// as a preview, a titled section, marked lists and numbered steps.

import { Breadcrumbs, Tag, cx } from '@pixel-scientists/ui';
import type { BreadcrumbItem } from '@pixel-scientists/ui';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { PageIntro } from '../PageColumn.tsx';

interface ScreenHeaderProps {
  title: string;
  /** Small text beside the "Design preview" tag, such as the fund. */
  eyebrow?: ReactNode;
  breadcrumbs?: readonly BreadcrumbItem[];
  /** Where the person is in the application, between the eyebrow and the title. */
  progress?: ReactNode;
  /** The sentences under the title that say what this screen is for. */
  children?: ReactNode;
}

/** How every applying preview starts: where you are, the preview mark, then the title and what the screen is for. */
export function ScreenHeader({
  title,
  eyebrow,
  breadcrumbs,
  progress,
  children,
}: ScreenHeaderProps) {
  return (
    <div className="flex flex-col gap-5">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Tag tone="info">Design preview</Tag>
          {eyebrow}
        </div>
        {progress}
      </div>
      <PageIntro title={title}>{children}</PageIntro>
    </div>
  );
}

/** A titled part of a page. The title is its name for screen readers too. */
export function Section({
  title,
  children,
  className,
  id,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** Set when a link, such as one in an error summary, takes the person here. */
  id?: string;
}) {
  const titleId = useId();
  return (
    <section id={id} aria-labelledby={titleId} className={cx('flex flex-col gap-4', className)}>
      <h2 id={titleId} className="text-xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function TickIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M3.5 8.5l3 3 6-6.5" />
    </svg>
  );
}

export function CrossIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

export function DocumentIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M4 1.75h5.5L13 5.25v9H4z" />
      <path d="M9.5 1.75v3.5H13" />
    </svg>
  );
}

export function ChevronIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

export function PlusIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/** A list whose marks say yes or no by shape as well as colour, such as who can apply and who cannot. */
export function MarkedList({ mark, items }: { mark: 'yes' | 'no'; items: readonly ReactNode[] }) {
  return (
    <ul role="list" className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex max-w-prose items-start gap-3 text-body text-ink">
          <span
            aria-hidden="true"
            className={cx(
              'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
              mark === 'yes' ? 'bg-success-soft text-success' : 'bg-sunken text-muted',
            )}
          >
            {mark === 'yes' ? <TickIcon /> : <CrossIcon />}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export interface Step {
  title: string;
  text: ReactNode;
}

/** What happens next, in order, with a thin line from one step to the next. */
export function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol role="list" className="flex flex-col">
      {steps.map((step, index) => (
        <li key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
          {index < steps.length - 1 && (
            <span aria-hidden="true" className="absolute top-9 bottom-1 left-4 w-px bg-divider" />
          )}
          <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-edge bg-surface text-sm font-semibold text-ink tabular-nums">
            {index + 1}
          </span>
          <div className="flex min-w-0 max-w-prose flex-col gap-1 pt-0.5">
            <h3 className="text-body font-semibold text-ink">{step.title}</h3>
            <p className="text-body text-muted">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One of the funder's contact details as a link a phone or mail app can open. */
export function ContactLine({ email, phone }: { email: string; phone?: string }) {
  return (
    <>
      <a href={`mailto:${email}`}>{email}</a>
      {phone !== undefined && (
        <>
          {' or '}
          <a href={`tel:${phone.replaceAll(' ', '')}`} className="whitespace-nowrap">
            {phone}
          </a>
        </>
      )}
    </>
  );
}
