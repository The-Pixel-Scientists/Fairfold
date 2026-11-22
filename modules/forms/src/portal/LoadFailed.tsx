// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Link, PageHeading, buttonClassName } from '@pixel-scientists/ui';

import { useFormsHost } from './host.tsx';

/** A form the API will not show: closed, not yet open, signed-in only, switched off or never there. One page for all, so it tells nobody which. */
export function FormNotFound() {
  const { embedded } = useFormsHost();
  return (
    <div className="mx-auto flex max-w-prose flex-col items-start gap-4 py-4 sm:py-10">
      <PageHeading className="text-3xl">We cannot find this form</PageHeading>
      <p className="text-lg text-ink">
        Check the link for typing mistakes. The form may have closed, or it may be only for people
        who sign in.
      </p>
      {!embedded && (
        <Link to="/" className={buttonClassName('primary')}>
          Go to the start page
        </Link>
      )}
    </div>
  );
}

/** The API could not be reached, so nothing is known about the form. */
export function LoadFailed({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto flex max-w-prose flex-col items-start gap-4 py-4 sm:py-10">
      <PageHeading className="text-3xl">We could not load this form</PageHeading>
      <p className="text-lg text-ink">
        Check that you are online, then try again. Nothing you have typed is lost.
      </p>
      <Button variant="primary" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
