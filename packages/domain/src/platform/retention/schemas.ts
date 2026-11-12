// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's retention settings (rule 5, ADR 0003): how many days each
// `tenant_policy` rule in the classification map keeps its data. The map
// names the policies and their platform minimums, which no tenant can go
// below; the domain package cannot read it, so the server refuses a period
// under the minimum with retentionDaysProblem() and the database refuses it
// again.

import { z } from 'zod';

import { messages, type FieldProblem } from '../messages.ts';

/** A policy as the classification map names it, such as `audit`. Unknown ids answer 404. */
export const retentionPolicyIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const MAX_RETENTION_DAYS = 36_500;

export const retentionDaysSchema = z
  .int({ error: messages.retentionDays })
  .min(1, { error: messages.retentionDays })
  .max(MAX_RETENTION_DAYS, { error: messages.retentionDays });

export const retentionPolicyQuerySchema = z.strictObject({ policyId: retentionPolicyIdSchema });

export const retentionChangeSchema = z.strictObject({ days: retentionDaysSchema });

export type RetentionChange = z.infer<typeof retentionChangeSchema>;

export const retentionPolicySchema = z.strictObject({
  policyId: retentionPolicyIdSchema,
  /** The key of the policy's name in retentionPolicyLabels. */
  labelKey: retentionPolicyIdSchema,
  /** The period in force: the tenant's own, or the default. */
  days: retentionDaysSchema,
  minimumDays: retentionDaysSchema,
  defaultDays: retentionDaysSchema,
  /** Whether the tenant has set its own period. */
  changed: z.boolean(),
});

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const retentionPolicyListSchema = z.strictObject({
  policies: z.array(retentionPolicySchema),
});

/** Names for the policies the classification map uses; a policy not listed shows its id. */
export const retentionPolicyLabels: Readonly<Record<string, string>> = {
  audit: 'Audit log',
  crm_import_jobs: 'Contact import jobs',
  crm_import_rows: 'Contact import rows',
};

/**
 * The field problem for a period under the policy's minimum. It names the
 * minimum and never the value sent.
 */
export function retentionDaysProblem(minimumDays: number): FieldProblem {
  return { field: 'body.days', message: messages.retentionTooShort(minimumDays) };
}
