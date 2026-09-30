// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Programme configuration schema and validators. Every saved change to a
// programme's configuration creates a new config version (architecture
// rule 10), so the document carries the schema version it was written for.

export {
  PROGRAMME_CONFIG_SCHEMA_VERSION,
  programmeConfigSchema,
  type ProgrammeConfig,
} from './programme-config.ts';
