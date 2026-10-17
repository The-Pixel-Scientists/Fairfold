// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the apply screens share: a page that reads from the API and keeps one
// heading while it loads, a titled part of a page, the steps that follow, and
// where focus goes when a screen opens.

import { Button, Link, LoadingState, buttonClassName, cx, useLocation } from '@pixel-scientists/ui';
import type { BreadcrumbItem } from '@pixel-scientists/ui';
import { Fragment, useEffect, useId } from 'react';
import type { ReactNode } from 'react';

import { Screen } from '../auth/Screen.tsx';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import type { Read } from '../party/useRead.ts';
import { productName } from '../product.ts';

/**
 * The frame of every apply page, for a signed-in applicant. The page starts
 * afresh at each address: the router keeps one page on show while only its
 * address changes, as from one section to the next, and the next section must
 * read the answers saved in between, not the ones the last one was built on.
 */
export function ApplyScreen({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Screen kind="applicant">
      <Fragment key={pathname}>{children}</Fragment>
    </Screen>
  );
}

export interface Heading {
  title: string;
  breadcrumbs: readonly BreadcrumbItem[];
  intro?: ReactNode;
}

/** What a loaded page shows. A page that draws its own h1, as a form section does, leaves `heading` out. */
export interface View {
  heading?: Heading;
  body: ReactNode;
}

/** What to say, and where to go, when the record is not there. */
export interface Missing {
  text: string;
  to: string;
  link: string;
}

export interface ApplyPageProps<T> {
  read: Read<T>;
  retry: () => void;
  /** The heading while the page loads, and if it cannot. */
  loading: Heading;
  /** The page, once what it shows has loaded. */
  view: (data: T) => View;
  missing: Missing;
}

/**
 * A page whose content is read from the API. The heading stays while the
 * content loads, so focus is not lost when it arrives, and the page says so
 * when it could not be read.
 */
export function ApplyPage<T>({ read, retry, loading, view, missing }: ApplyPageProps<T>) {
  const ready = read.status === 'ready' ? view(read.data) : null;
  const gone = read.status === 'failed' && read.missing;
  const heading = ready === null ? loading : ready.heading;
  return (
    <PageColumn>
      {heading && (
        <PageIntro title={heading.title} breadcrumbs={heading.breadcrumbs}>
          {read.status === 'failed' ? (
            <p>
              {gone
                ? missing.text
                : 'We could not load this page. Check that you are online, then try again.'}
            </p>
          ) : (
            heading.intro
          )}
        </PageIntro>
      )}
      {ready?.body}
      {read.status === 'loading' && <LoadingState label="Loading" />}
      {read.status === 'failed' &&
        (gone ? (
          <div>
            <Link to={missing.to} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
              {missing.link}
            </Link>
          </div>
        ) : (
          <div>
            <Button variant="primary" className="w-full sm:w-auto" onClick={retry}>
              Try again
            </Button>
          </div>
        ))}
    </PageColumn>
  );
}

/** A titled part of a page. The title names it for screen readers too. */
export function Block({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx('flex flex-col gap-4', className)}>
      <h2 id={titleId} className="text-xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {children}
    </section>
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
          <span
            aria-hidden="true"
            className="relative grid size-8 shrink-0 place-items-center rounded-full border border-edge bg-surface text-sm font-semibold text-ink tabular-nums"
          >
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

/** Text in paragraphs: a blank line starts a new one. */
export function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((paragraph) => paragraph.trim() !== '')
        .map((paragraph) => (
          <p key={paragraph} className="max-w-prose whitespace-pre-line text-body text-ink">
            {paragraph}
          </p>
        ))}
    </>
  );
}

/**
 * The title of the browser tab, for a page whose name is known only once it
 * has loaded, such as a section of a form. The router sets a general title
 * when the page opens, and this follows it.
 */
export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = `${title} – ${productName}`;
  }, [title]);
  return null;
}

/**
 * Where focus goes when a screen has loaded. The router put it on the heading
 * of the page while it loaded; a screen with its own heading, or a link to one
 * question such as `#f_name`, takes it from there.
 */
export function useArrivalFocus(): void {
  const { hash } = useLocation();
  useEffect(() => {
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target !== null) {
      target.focus();
    } else if (document.activeElement === null || document.activeElement === document.body) {
      document.querySelector<HTMLElement>('main h1')?.focus();
    }
  }, [hash]);
}
