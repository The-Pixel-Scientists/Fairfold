// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, PageHeading, useSession } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';

import { FunderList } from '../shell/FunderList.tsx';

/**
 * Shown when the signed-in person is not working for the funder in the
 * address: either they have no membership there, or they have one and need
 * to switch to it. Either way they can switch to any other funder, or sign out.
 */
export function AccessPage({ session, slug }: { session: SessionData; slug: string }) {
  const { signOut } = useSession();
  const wanted = session.memberships.find(({ tenant }) => tenant.slug === slug);
  const others = session.memberships.filter(({ id }) => id !== session.activeMembership?.id);

  return (
    <>
      <PageHeading>
        {wanted ? `Switch to ${wanted.tenant.name}` : `You do not have access to ${slug}`}
      </PageHeading>
      <p className="text-body text-muted">
        {wanted
          ? 'You are signed in to a different funder. Switch to open this page.'
          : 'Your account is not a member of this funder. Ask its administrator to invite you.'}
      </p>
      {others.length > 0 && <FunderList memberships={others} />}
      <div>
        <Button
          onClick={() => {
            void signOut().catch(() => undefined);
          }}
        >
          Sign out
        </Button>
      </div>
    </>
  );
}
