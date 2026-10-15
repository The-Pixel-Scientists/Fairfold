// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the portal's application routes accept. Inputs are strict and never
// name the applicant: that is the session's person. The server checks
// everything again: the organisation is one the caller is a current contact
// for, and answers are checked by validateAnswers() against the pinned form
// version.

import { idSchema } from '@pixel-scientists/domain';
import { answersSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

/** The organisation applying, which must be one the caller is a current contact for. */
export const startApplicationInputSchema = z.strictObject({ organisationId: idSchema });

export type StartApplicationInput = z.infer<typeof startApplicationInputSchema>;

/** The `answersVersion` the applicant's answers were based on. */
const basedOn = z.int().min(1);

/** All the saved answers, replacing those before. */
export const saveAnswersInputSchema = z.strictObject({ basedOn, answers: answersSchema });

export type SaveAnswersInput = z.infer<typeof saveAnswersInputSchema>;

/** Submits the saved answers the applicant last saw. */
export const submitApplicationInputSchema = z.strictObject({ basedOn });

export type SubmitApplicationInput = z.infer<typeof submitApplicationInputSchema>;
