// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The portal's sections (ADR 0016): one entry for each tool an applicant can
// use. Adding a tool means one entry here. A tool's code loads only when one
// of its addresses is first opened.

import { modules, permissions } from '@pixel-scientists/domain/platform';
import type { SwitchableModuleId } from '@pixel-scientists/domain/platform';
import { hasPermission } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';

import { APPLICATIONS_PATH, PROFILE_PATH } from '../paths.ts';

export interface PortalModule {
  id: 'party' | SwitchableModuleId;
  /** What the section is called. */
  label: string;
  /** One plain line on what the person can do there. */
  description: string;
  /** Where the section opens, inside the funder's address. */
  path: string;
  /** Imports the tool's portal package. */
  load: () => Promise<unknown>;
}

export const grantsModule: PortalModule = {
  id: 'grants',
  label: modules.grants.label,
  description: 'Start or continue an application.',
  path: APPLICATIONS_PATH,
  load: () => import('@pixel-scientists/grants/portal'),
};

/** In the order the front door shows them, which never changes as tools are switched on. */
export const portalModules: readonly PortalModule[] = [
  {
    id: 'party',
    label: 'Your details and organisations',
    description: 'Keep your details and your organisations up to date.',
    path: PROFILE_PATH,
    load: () => import('@pixel-scientists/party/portal'),
  },
  grantsModule,
];

/** The session as the server returns it: the tools switched on for the funder are ids only, and left out until the server reports them. */
type FrontDoorSession = SessionData & { readonly modules?: readonly string[] };

/**
 * Whether the person sees a section: the tool is switched on for the funder
 * (party always is; a missing list means off, ADR 0024) and they hold one of
 * its portal permissions. This only decides what to show; the server refuses
 * the rest.
 */
export function isVisible(session: FrontDoorSession, { id }: PortalModule): boolean {
  const on = id === 'party' || (session.modules ?? []).includes(id);
  return (
    on &&
    Object.entries(permissions).some(
      ([name, { app }]) =>
        app === 'portal' && name.startsWith(`${id}.`) && hasPermission(session, name),
    )
  );
}

/** The sections this session may see: none without a session. */
export function visibleSections(session: FrontDoorSession | null): readonly PortalModule[] {
  return session === null ? [] : portalModules.filter((entry) => isVisible(session, entry));
}
