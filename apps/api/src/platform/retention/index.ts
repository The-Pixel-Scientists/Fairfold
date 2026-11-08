// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The retention settings routes, matched with their contracts, and the sweep
// the nightly job runs.

import {
  changeRetentionPolicy,
  listRetentionPolicies,
} from '@pixel-scientists/domain/platform/retention';

import { route, type Route } from '../../routes/register.ts';
import { changeRetentionPolicyHandler, listRetentionPoliciesHandler } from './settings.ts';

export const retentionRoutes: readonly Route[] = [
  route(listRetentionPolicies, listRetentionPoliciesHandler),
  route(changeRetentionPolicy, changeRetentionPolicyHandler),
];

export { AUDIT_PURGE_CAP, purgeAudit, sweepTenant, type Applied, type Swept } from './sweep.ts';
