// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

export const PROGRAMME_CONFIG_SCHEMA_VERSION = 1;

/**
 * The root of a programme's configuration. Stages, forms, rubrics and
 * templates are added as the epics that own them land. Unknown keys are
 * rejected so a typo never passes silently.
 */
export const programmeConfigSchema = z.strictObject({
  schemaVersion: z.literal(PROGRAMME_CONFIG_SCHEMA_VERSION),
});

export type ProgrammeConfig = z.infer<typeof programmeConfigSchema>;
