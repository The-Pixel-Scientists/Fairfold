// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every console and portal route contract the API serves, read from the
// published contracts themselves (ADR 0016): each module's, and the
// platform's settings, team, audit log and warehouse. A route added to any of
// them is found here without an edit, and the isolation walk then insists on a
// case for it.

import type { RouteContract } from '../../packages/domain/src/api/index.ts';
import { listAuditEvents } from '../../packages/domain/src/platform/audit-log/index.ts';
import * as settings from '../../packages/domain/src/platform/settings/index.ts';
import * as team from '../../packages/domain/src/platform/team/index.ts';
import { getWarehouseSnapshot } from '../../packages/domain/src/warehouse/index.ts';
import * as grants from '../../modules/grants/src/contracts/index.ts';
import * as party from '../../modules/party/src/contracts/index.ts';

export type MemberRoute = Extract<RouteContract, { audience: 'console' | 'portal' }>;

const isRoute = (value: unknown): value is RouteContract =>
  typeof value === 'object' &&
  value !== null &&
  'method' in value &&
  'path' in value &&
  'audience' in value;

const isMember = (route: RouteContract): route is MemberRoute =>
  route.audience === 'console' || route.audience === 'portal';

/** `GET /console/programmes/:programmeId`: how a route is named in the cases. */
export const keyOf = ({ method, path }: RouteContract): string => `${method} ${path}`;

/** The console and portal routes, once each, in the order the contracts list them. */
export function memberRoutes(): MemberRoute[] {
  const found = new Map<string, MemberRoute>();
  const sources: unknown[] = [
    grants,
    party,
    settings,
    team,
    { listAuditEvents, getWarehouseSnapshot },
  ];
  for (const source of sources) {
    for (const value of Object.values(source as Record<string, unknown>)) {
      if (isRoute(value) && isMember(value)) found.set(keyOf(value), value);
    }
  }
  return [...found.values()];
}
