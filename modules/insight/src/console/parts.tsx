// SPDX-License-Identifier: AGPL-3.0-or-later

import { buttonClassName, Link, useSession } from '@pixel-scientists/ui';
import type { ButtonVariant } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

/** A link that looks like a button, for going to another screen. */
export function LinkButton({
  to,
  variant = 'secondary',
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClassName(variant)}>
      {children}
    </Link>
  );
}

/** A heading over a table or list, so heading navigation finds it. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Names a member as the response allows: it carries an id only, so the person is "You" or "A colleague". */
export function useWho(): (membershipId: string) => string {
  const { state } = useSession();
  const mine = state.status === 'ready' ? state.session.activeMembership?.id : undefined;
  return (membershipId) => (membershipId === mine ? 'You' : 'A colleague');
}
