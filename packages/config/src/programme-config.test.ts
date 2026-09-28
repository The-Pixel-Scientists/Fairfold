// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { PROGRAMME_CONFIG_SCHEMA_VERSION, programmeConfigSchema } from './index.ts';

describe('programmeConfigSchema', () => {
  it('accepts a configuration for the current schema version', () => {
    const result = programmeConfigSchema.safeParse({
      schemaVersion: PROGRAMME_CONFIG_SCHEMA_VERSION,
    });
    expect(result.success).toBe(true);
  });

  it('rejects another schema version', () => {
    expect(programmeConfigSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = programmeConfigSchema.safeParse({
      schemaVersion: PROGRAMME_CONFIG_SCHEMA_VERSION,
      stages: [],
    });
    expect(result.success).toBe(false);
  });
});
