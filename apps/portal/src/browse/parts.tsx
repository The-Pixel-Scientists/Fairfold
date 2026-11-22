// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the two public pages share: the frame, and what to show while the
// answer loads, when the funder or round is not found, and when it fails.

import { NotFoundPage, Button, LoadingState } from '@pixel-scientists/ui';
import type { BreadcrumbItem } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { Screen } from '../auth/Screen.tsx';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import type { Read } from '../party/useRead.ts';

interface PublicReadProps<T> {
  /** The heading while the page loads or fails. */
  title: string;
  breadcrumbs: readonly BreadcrumbItem[];
  read: Read<T>;
  retry: () => void;
  children: (data: T) => ReactNode;
}

/**
 * A page read from a public route. Every not found looks the same, and says
 * nothing of the funder or the round asked for.
 */
export function PublicRead<T>({ title, breadcrumbs, read, retry, children }: PublicReadProps<T>) {
  return (
    <Screen kind="open">
      <PageColumn>
        {read.status === 'ready' && children(read.data)}
        {read.status === 'loading' && (
          <>
            <PageIntro title={title} breadcrumbs={breadcrumbs} />
            <LoadingState label="Loading" />
          </>
        )}
        {read.status === 'failed' && read.missing && <NotFoundPage />}
        {read.status === 'failed' && !read.missing && (
          <>
            <PageIntro title={title} breadcrumbs={breadcrumbs}>
              <p>
                {read.limited ??
                  'We could not load this page. Check that you are online, then try again.'}
              </p>
            </PageIntro>
            <div>
              <Button variant="primary" className="w-full sm:w-auto" onClick={retry}>
                Try again
              </Button>
            </div>
          </>
        )}
      </PageColumn>
    </Screen>
  );
}
