// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Retention settings for tenant admins. A change is versioned configuration
// (`platform.retention`, rule 10) and writes `platform.retention_policy.changed`.
// The policy id travels in the query, since a path parameter is always an id
// (schema-rules.ts) and a policy is named, not numbered.

import { defineRoute } from '../../api/route.ts';
import {
  retentionChangeSchema,
  retentionPolicyListSchema,
  retentionPolicyQuerySchema,
  retentionPolicySchema,
} from './schemas.ts';

const settings = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.retention.manage',
  scope: 'tenant',
  path: '/console/retention-policies',
} as const;

export const listRetentionPolicies = defineRoute({
  ...settings,
  method: 'GET',
  summary: "Read how long each kind of the tenant's data is kept, with its platform minimum",
  responses: { 200: retentionPolicyListSchema },
});

/** A period under the policy's minimum is refused with retentionDaysProblem(). */
export const changeRetentionPolicy = defineRoute({
  ...settings,
  method: 'PUT',
  stepUp: true,
  summary: 'Change how many days one kind of data is kept, never below its platform minimum',
  query: retentionPolicyQuerySchema,
  body: retentionChangeSchema,
  responses: { 200: retentionPolicySchema },
});

export const retentionRoutes = { listRetentionPolicies, changeRetentionPolicy } as const;
