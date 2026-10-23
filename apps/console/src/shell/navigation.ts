// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Permission } from '@pixel-scientists/domain/platform';
import { grantsNavigation } from '@pixel-scientists/grants/console';
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
  /** Another permission that opens the page, for a page with a part for each. */
  or?: Permission;
}

export const navigationItems: readonly NavigationItem[] = [
  ...grantsNavigation,
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

/** The items this session may use. The server still checks every request. */
export function visibleItems(
  session: Pick<SessionData, 'permissions'>,
  items: readonly NavigationItem[] = navigationItems,
): NavigationItem[] {
  return items.filter(
    (item) =>
      hasPermission(session, item.permission) ||
      (item.or !== undefined && hasPermission(session, item.or)),
  );
}
