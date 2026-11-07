// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Retention contracts: the `/platform/retention` subpath of the domain package.

import '../../jitless/index.ts';

export { changeRetentionPolicy, listRetentionPolicies, retentionRoutes } from './routes.ts';
export {
  MAX_RETENTION_DAYS,
  retentionChangeSchema,
  retentionDaysProblem,
  retentionDaysSchema,
  retentionPolicyIdSchema,
  retentionPolicyLabels,
  retentionPolicyListSchema,
  retentionPolicyQuerySchema,
  retentionPolicySchema,
  type RetentionChange,
  type RetentionPolicy,
} from './schemas.ts';
