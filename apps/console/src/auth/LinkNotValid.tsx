// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, PageHeading, buttonClassName } from '@pixel-scientists/ui';

/** What an emailed-link page says when it has no usable token, which changes nothing and asks for nothing. */
export function LinkNotValid({ askAgainTo }: { askAgainTo: string }) {
  return (
    <>
      <PageHeading>This link does not work</PageHeading>
      <p className="text-body text-muted">
        It may have been used already, or it may have run out. Use the link in your latest email, or
        ask for a new one.
      </p>
      <div>
        <Link to={askAgainTo} className={buttonClassName('primary')}>
          Ask for a new link
        </Link>
      </div>
    </>
  );
}
