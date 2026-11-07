// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the monitoring routes answer (ADR 0004, ADR 0032). The portal's are
// the applicant's own and the only responses that carry a monitoring answer
// or say whether one exists. The console's says only which published form
// version a round uses, never anything about a response.

import { idSchema } from '@pixel-scientists/domain';
import { projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

/** The version of the privacy notice an applicant was shown, as the server names it. */
export const privacyNoticeVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/);

/**
 * A round's monitoring form for one of the applicant's submitted
 * applications, with the privacy notice version to agree to. Answers can be
 * given until `closesAt`, local to `timeZone`: the later of the round's
 * closing time and the application's own extensions
 * (shownMonitoringClosingTime()). The server accepts answers until
 * monitoringClosingTime(), which may be later but is never shown, since it
 * counts other organisations' extensions.
 */
export const monitoringFormSchema = z.object({
  formVersionId: idSchema,
  definition: formDefinitionSchema,
  privacyNoticeVersion: privacyNoticeVersionSchema,
  closesAt: z.string(),
  timeZone: z.string(),
});

export type MonitoringForm = z.infer<typeof monitoringFormSchema>;

/** The applicant's own answers and the consent they gave with them. */
export const monitoringResponseSchema = z.object({
  formVersionId: idSchema,
  answers: projectedAnswersSchemas.applicant,
  privacyNoticeVersion: privacyNoticeVersionSchema,
  consentGivenAt: z.iso.datetime(),
});

export type MonitoringResponse = z.infer<typeof monitoringResponseSchema>;

/** The applicant's own response, or null when they have not answered or have withdrawn. */
export const monitoringAnswerSchema = z.object({ response: monitoringResponseSchema.nullable() });

export type MonitoringAnswer = z.infer<typeof monitoringAnswerSchema>;

/** The published form version a round uses for monitoring, or null for none. */
export const roundMonitoringFormSchema = z.object({ formVersionId: idSchema.nullable() });

export type RoundMonitoringForm = z.infer<typeof roundMonitoringFormSchema>;
