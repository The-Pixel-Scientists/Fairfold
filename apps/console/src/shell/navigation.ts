// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Permission } from '@pixel-scientists/domain/platform';
import { hasPermission } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';

export interface NavigationItem {
  /** A path inside the funder's address. */
  to: string;
  label: string;
  /** The permission that opens the page. Without it the item is not shown. */
  permission: Permission;
}

export const navigationItems: readonly NavigationItem[] = [
  { to: '/', label: 'Programmes', permission: 'grants.programmes.manage' },
  { to: '/settings', label: 'Settings', permission: 'platform.settings.manage' },
];

/** The items this session may use. The server still checks every request. */
export function visibleItems(
  session: Pick<SessionData, 'permissions'>,
  items: readonly NavigationItem[] = navigationItems,
): NavigationItem[] {
  return items.filter((item) => hasPermission(session, item.permission));
}
