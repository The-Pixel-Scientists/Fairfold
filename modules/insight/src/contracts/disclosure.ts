// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Disclosure rules (ADR 0032): the threshold below which a count of people
// is suppressed, and the minimum group below which a table is withheld
// whole. They are a tenant's versioned configuration in
// `insight.disclosure_rule` (rule 10), recorded as `insight.disclosure_rule`
// config versions. A tenant may raise them and never lower them below the
// platform floor; a database check holds the same floor. Secondary
// suppression always applies: no setting weakens protection.

import { z } from 'zod';

import { insightMessages, says } from './messages.ts';

/** The platform floor, and the rule a tenant without its own applies. Only a migration lowers it. */
export const disclosureFloor = { threshold: 10, minimumGroup: 20 } as const;

export const disclosureRuleInputSchema = z
  .strictObject({
    threshold: z.int().min(disclosureFloor.threshold).max(1000),
    minimumGroup: z.int().min(disclosureFloor.minimumGroup).max(10_000),
  })
  .refine(({ threshold, minimumGroup }) => minimumGroup >= threshold, {
    ...says(insightMessages.minimumGroup),
    path: ['minimumGroup'],
  });

export type DisclosureRuleInput = z.infer<typeof disclosureRuleInputSchema>;

/** The rule a report applies. The version is null while the tenant keeps the platform floor. */
export const appliedDisclosureRuleSchema = z.strictObject({
  version: z.int().min(1).nullable(),
  threshold: z.int().min(disclosureFloor.threshold),
  minimumGroup: z.int().min(disclosureFloor.minimumGroup),
});

export type AppliedDisclosureRule = z.infer<typeof appliedDisclosureRuleSchema>;

export const disclosureRuleSchema = z.strictObject({
  ...appliedDisclosureRuleSchema.shape,
  updatedAt: z.iso.datetime().nullable(),
});

export type DisclosureRule = z.infer<typeof disclosureRuleSchema>;
