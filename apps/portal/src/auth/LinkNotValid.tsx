// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, buttonClassName } from '@pixel-scientists/ui';

import { PageColumn, PageIntro } from '../PageColumn.tsx';

export interface LinkNotValidProps {
  /** Where to ask for a new link, inside the funder's address. */
  askAgainTo: string;
  /** How long this kind of link lasts, in words, such as "24 hours". */
  lasts: string;
}

/** What an emailed-link page says when it has no usable token. It changes nothing and asks for nothing. */
export function LinkNotValid({ askAgainTo, lasts }: LinkNotValidProps) {
  return (
    <PageColumn>
      <PageIntro title="This link does not work">
        <p>
          A link works once and lasts {lasts}. This one may have been used already, or it may be too
          old.
        </p>
        <p>Use the link in your latest email, or ask for a new one.</p>
      </PageIntro>
      <div>
        <Link to={askAgainTo} className={buttonClassName('primary', 'w-full sm:w-auto')}>
          Ask for a new link
        </Link>
      </div>
    </PageColumn>
  );
}
