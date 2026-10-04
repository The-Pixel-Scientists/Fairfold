// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { standaloneLink } from '../links.ts';

export interface PromptProps {
  /** Where the link goes, inside the funder's address. */
  to: string;
  /** What the link says. Say where it goes: "Sign in", not "Click here". */
  link: string;
  /** A question or a few words before the link, such as "Already have an account?". */
  children?: ReactNode;
}

/** A way out of the page, in words: an optional question and the link that answers it. */
export function Prompt({ to, link, children }: PromptProps) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-body text-ink">
      {children}
      <Link to={to} className={standaloneLink}>
        {link}
      </Link>
    </p>
  );
}
