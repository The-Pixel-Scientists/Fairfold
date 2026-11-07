// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's published events (ADR 0034). A response was submitted,
// signed in or anonymously: ids, the version number and the route only,
// never an answer or anything about the respondent. Readable by staff who
// may read responses.

import { idSchema } from '@pixel-scientists/domain';
import { defineEvent } from '@pixel-scientists/domain/events';
import { z } from 'zod';

import { responseRoutes } from './schemas.ts';

export const responseSubmitted = defineEvent('forms.response_submitted.v1', {
  read: 'forms.responses.read',
  data: z.strictObject({
    responseId: idSchema,
    formId: idSchema,
    version: z.int().min(1),
    route: z.enum(responseRoutes),
  }),
});
