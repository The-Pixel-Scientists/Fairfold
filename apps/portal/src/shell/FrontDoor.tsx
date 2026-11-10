// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useSession } from '@pixel-scientists/ui';

import { standaloneLink } from '../links.ts';
import { PageColumn, PageIntro } from '../PageColumn.tsx';
import { GetReady } from '../party/GetReady.tsx';
import { SavedNotice } from '../party/Saved.tsx';
import { visibleSections } from './modules.ts';

/** What a signed-in person sees first: a link to each tool the funder has switched on for them. */
export function FrontDoor() {
  const { state } = useSession();
  const sections = visibleSections(state.status === 'ready' ? state.session : null);
  return (
    <PageColumn>
      <PageIntro title="Apply for a grant">
        <SavedNotice />
        <p>You are signed in. Choose where you want to go.</p>
      </PageIntro>
      <ul role="list" className="flex flex-col gap-4">
        {sections.map(({ id, label, description, path }) => (
          <li
            key={id}
            className="flex flex-col gap-1 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised) sm:p-6"
          >
            <Link
              to={path}
              className={`${standaloneLink} text-lg font-semibold [overflow-wrap:anywhere]`}
            >
              {label}
            </Link>
            <p className="text-body text-muted">{description}</p>
          </li>
        ))}
      </ul>
      <GetReady />
    </PageColumn>
  );
}
