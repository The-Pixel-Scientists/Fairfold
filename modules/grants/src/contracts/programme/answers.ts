// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the programme set-up routes answer. These are staff answers only:
// the portal reads programmes and rounds through its own contracts (S06-04),
// which never reuse these (ADR 0004).

import { idSchema } from '@pixel-scientists/domain';
import { moneySchema } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { latePolicySchema, programmeStatusSchema } from './lists.ts';

export const programmeSchema = z.object({
  id: idSchema,
  title: z.string(),
  summary: z.string(),
  description: z.string(),
  status: programmeStatusSchema,
});

export type Programme = z.infer<typeof programmeSchema>;

/**
 * Opening and closing are local to `timeZone`, the zone they were entered
 * in, in the form roundInputSchema takes: `2027-02-02T09:00`.
 */
export const roundSchema = z.object({
  id: idSchema,
  programmeId: idSchema,
  title: z.string(),
  opensAt: z.string(),
  closesAt: z.string(),
  timeZone: z.string(),
  budget: moneySchema,
  awardMinimum: moneySchema,
  awardMaximum: moneySchema,
  latePolicy: latePolicySchema,
});

export type Round = z.infer<typeof roundSchema>;

/** A programme's rounds, the latest opening first. */
export const roundListSchema = z.object({ rounds: z.array(roundSchema) });

export type RoundList = z.infer<typeof roundListSchema>;

/** Programmes by title, each with its rounds, so a list can show the current one. */
export const programmeListSchema = z.object({
  programmes: z.array(
    programmeSchema.omit({ description: true }).extend({ rounds: z.array(roundSchema) }),
  ),
});

export type ProgrammeList = z.infer<typeof programmeListSchema>;

/** Its id is what scores refer to. */
export const criterionSchema = z.object({
  id: idSchema,
  label: z.string(),
  guidance: z.string(),
  weight: z.int(),
  scaleMin: z.int(),
  scaleMax: z.int(),
});

export type Criterion = z.infer<typeof criterionSchema>;

/** A stage and its rubric's criteria, in order; none when it has no rubric. `position` counts from 1. */
export const stageSchema = z.object({
  id: idSchema,
  name: z.string(),
  position: z.int(),
  criteria: z.array(criterionSchema),
});

export type Stage = z.infer<typeof stageSchema>;

/** A round's stages in order. */
export const stageListSchema = z.object({ stages: z.array(stageSchema) });

export type StageList = z.infer<typeof stageListSchema>;

/** A template's latest version. */
export const emailTemplateSchema = z.object({
  subject: z.string(),
  body: z.string(),
  version: z.int(),
});

export const emailTemplatesSchema = z.object({
  accepted: emailTemplateSchema,
  waitlisted: emailTemplateSchema,
  declined: emailTemplateSchema,
});

export type EmailTemplates = z.infer<typeof emailTemplatesSchema>;
