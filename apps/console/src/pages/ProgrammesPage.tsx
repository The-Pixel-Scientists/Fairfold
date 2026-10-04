// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, PageHeading } from '@pixel-scientists/ui';

import { Screen } from '../auth/Screen.tsx';

/** The console's first page. Programme set-up has not been built, so the list is always empty. */
export default function ProgrammesPage() {
  return (
    <Screen kind="member">
      <div className="flex flex-col gap-stack">
        <PageHeading>Programmes</PageHeading>
        <EmptyState title="No programmes yet">
          <p>
            A programme is one grant you run, with its rounds, forms and reviewers. When your team
            sets one up, it appears here.
          </p>
          <p className="mt-2">
            Ask your administrator to set up a programme, or to add you to one that exists.
          </p>
        </EmptyState>
      </div>
    </Screen>
  );
}
