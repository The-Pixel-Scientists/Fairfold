// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the monitoring routes accept. Inputs are strict and never name the
// respondent, who is the session's person. The server checks everything
// again: the form version is the round's monitoring form, the privacy notice
// version is the one it shows, the answers pass validateAnswers() against
// that version, and the round has not closed for monitoring.

import { idSchema } from '@pixel-scientists/domain';
import { answersSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { privacyNoticeVersionSchema } from './answers.ts';
import { monitoringMessages, says } from './messages.ts';

/**
 * Answers with their own explicit consent (UK GDPR Article 9(2)(a)), apart
 * from the application's: refused unless `consent` is true.
 */
export const monitoringResponseInputSchema = z.strictObject({
  formVersionId: idSchema,
  answers: answersSchema,
  consent: z.boolean().refine((given) => given, says(monitoringMessages.consent)),
  privacyNoticeVersion: privacyNoticeVersionSchema,
});

export type MonitoringResponseInput = z.infer<typeof monitoringResponseInputSchema>;

/** A published form version of the round that passes monitoringDefinitionProblems(), or null for none. */
export const roundMonitoringFormInputSchema = z.strictObject({
  formVersionId: idSchema.nullable(),
});

export type RoundMonitoringFormInput = z.infer<typeof roundMonitoringFormInputSchema>;
