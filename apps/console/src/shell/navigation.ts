// SPDX-License-Identifier: AGPL-3.0-or-later

import { modules, moduleOn, permissions } from '@pixel-scientists/domain/platform';
import type { Permission, SwitchableModuleId } from '@pixel-scientists/domain/platform';
import { grantsNavigation } from '@pixel-scientists/grants/console';
import { consoleModules } from '../modules.ts';
import type { ConsoleModule } from '../modules.ts';
import { AUDIT_LOG_PATH } from '../platform/audit-log/paths.ts';
import { DATA_PATH } from '../platform/data/paths.ts';
import { TEAM_PATH } from '../platform/team/paths.ts';
import { hasPermission } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';

export interface NavigationItem {
  /** A path inside the funder's address. */
  to: string;
  label: string;
  /** The permission that opens the page. Without it, or the one in `or`, the item is not shown. */
  permission: Permission;
  /** Other permissions that open the page, for a page with a part for each. */
  or?: Permission | readonly Permission[];
  /** The tool the page belongs to. The item is shown only while that tool is on for the funder. */
  module?: SwitchableModuleId;
}

/** What the navigation needs of a session. `modules` is what is switched on for the funder, once the server reports it. */
export type NavigationSession = Pick<SessionData, 'permissions'> & {
  readonly modules?: readonly string[];
};

/** A tool's one link: shown to a member who holds any of the tool's console permissions. */
export function moduleItem({ id, path }: ConsoleModule): NavigationItem {
  const [permission, ...rest] = (Object.keys(permissions) as Permission[]).filter(
    (name) => name.startsWith(`${id}.`) && permissions[name].app === 'console',
  );
  if (permission === undefined) throw new Error(`The ${id} module has no console permission.`);
  return { to: path, label: modules[id].label, permission, or: rest, module: id };
}

function sectionItems(entry: ConsoleModule): NavigationItem[] {
  return entry.load
    ? [moduleItem(entry)]
    : grantsNavigation.map((item) => ({ ...item, module: entry.id }));
}

export const navigationItems: readonly NavigationItem[] = [
  ...consoleModules.flatMap(sectionItems),
  { to: TEAM_PATH, label: 'Team', permission: 'platform.members.manage' },
  {
    to: DATA_PATH,
    label: 'Data',
    permission: 'platform.warehouse.export',
    or: 'grants.data.export',
  },
  { to: AUDIT_LOG_PATH, label: 'Audit log', permission: 'platform.audit.read' },
  { to: '/settings', label: 'Settings', permission: 'platform.settings.manage' },
];

/**
 * The items this session may use: the tool is on for the funder (a session
 * that does not say counts as off, except for grants, as `moduleOn` has it)
 * and the member holds the permission. The server still checks every request.
 */
export function visibleItems(
  session: NavigationSession,
  items: readonly NavigationItem[] = navigationItems,
): NavigationItem[] {
  return items.filter((item) => {
    if (
      item.module !== undefined &&
      !moduleOn(item.module, session.modules?.includes(item.module))
    ) {
      return false;
    }
    return [item.permission, ...[item.or ?? []].flat()].some((name) =>
      hasPermission(session, name),
    );
  });
}
