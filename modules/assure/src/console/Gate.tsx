// SPDX-License-Identifier: AGPL-3.0-or-later

import { NotFoundPage, useCan, useParams, useSession } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

/** A parameter of the page's address. The route has checked that it is an id. */
export function useParam(name: string): string {
  return useParams()[name] ?? '';
}

/** The tools switched on for the funder, as the session reports them. */
function toolsOn(session: object): readonly unknown[] {
  return 'modules' in session && Array.isArray(session.modules) ? session.modules : [];
}

/**
 * The pages for a member who holds `permission`, while assure is on for the
 * funder. Anyone else gets the page for an address that is not there, and
 * the page makes no request.
 */
export function Gate({
  permission,
  children,
}: {
  permission: 'assure.lookup.read' | 'assure.screening.read';
  children: ReactNode;
}) {
  const { state } = useSession();
  const can = useCan(permission);
  const on = state.status === 'ready' && toolsOn(state.session).includes('assure');
  return can && on ? <div className="flex flex-col gap-stack">{children}</div> : <NotFoundPage />;
}
