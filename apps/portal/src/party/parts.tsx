// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Link, LoadingState, buttonClassName } from '@pixel-scientists/ui';
import type { BreadcrumbItem } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { HOME_PATH } from '../paths.ts';
import type { Read } from './useRead.ts';

/** The first step of every breadcrumb: back to the page that lists what to do. */
export const homeCrumb: BreadcrumbItem = { label: 'Apply for a grant', to: HOME_PATH };

export interface ReadPageProps<T> {
  title: string;
  breadcrumbs: readonly BreadcrumbItem[];
  /** The few sentences under the title that say what this screen is for. */
  intro?: ReactNode;
  read: Read<T>;
  retry: () => void;
  /** What to say, and where to go, when the record is not there. */
  missing?: { text: string; to: string; link: string };
  /** The rest of the page, once what it shows has loaded. */
  children: (data: T) => ReactNode;
}

/**
 * A page whose content is read from the API. The heading stays while the
 * content loads, so focus is not lost when it arrives, and the page says so
 * when it could not be read.
 */
export function ReadPage<T>({
  title,
  breadcrumbs,
  intro,
  read,
  retry,
  missing,
  children,
}: ReadPageProps<T>) {
  const gone = read.status === 'failed' && read.missing && missing !== undefined;
  return (
    <PageColumn>
      <PageIntro title={title} breadcrumbs={breadcrumbs}>
        {read.status === 'failed' ? (
          <p>
            {gone
              ? missing.text
              : 'We could not load this page. Check that you are online, then try again.'}
          </p>
        ) : (
          intro
        )}
      </PageIntro>
      {read.status === 'ready' && children(read.data)}
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

/** Says that what is typed is kept until the window closes, so leaving a form does not lose it. */
export function KeptNote() {
  return (
    <p className="max-w-prose text-body text-muted">
      If you leave this page before you save, we keep what you typed until you close this window.
    </p>
  );
}

/** Says that the form opened with what the person typed last time, not with what is saved. */
export function RestoredNotice() {
  return (
    <p className="max-w-prose rounded-md border border-divider bg-accent-soft p-4 text-body text-ink">
      We kept what you typed last time. Check it, then save.
    </p>
  );
}
