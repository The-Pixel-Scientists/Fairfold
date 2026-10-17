// SPDX-License-Identifier: AGPL-3.0-or-later

import { configEntityTypes } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { formConfigEntityType } from '../forms/config.ts';
import { grantsConfigEntityTypes } from '../programme/config.ts';
import { exportMessages } from './messages.ts';
import {
  publisherAnswerSchema,
  publisherSettingConfigEntityType,
  publisherSettingInputSchema,
} from './publisher.ts';

const valid = {
  funderIdentifier: 'GB-CHC-7654321',
  funderName: 'Northfield Foundation',
  identifierPrefix: '360G-northfield',
};

function messageFor(change: Record<string, unknown>) {
  return publisherSettingInputSchema.safeParse({ ...valid, ...change }).error?.issues[0]?.message;
}

describe('publisher settings', () => {
  it('take a funder identifier, name and prefix, trimmed', () => {
    expect(publisherSettingInputSchema.parse(valid)).toEqual(valid);
    expect(
      publisherSettingInputSchema.parse({ ...valid, funderName: '  Northfield Foundation ' }),
    ).toEqual(valid);
    expect(
      publisherSettingInputSchema.parse({ ...valid, funderIdentifier: 'GB-COH-SC123456' }),
    ).toMatchObject({ funderIdentifier: 'GB-COH-SC123456' });
  });

  it('refuse an identifier that is not an org-id.guide identifier', () => {
    for (const funderIdentifier of ['GB-CHC', 'gb-chc-1234567', 'GB-CHC-12 34', '1234567', '']) {
      expect(messageFor({ funderIdentifier }), funderIdentifier).toBe(
        exportMessages.funderIdentifier,
      );
    }
  });

  it('refuse an empty name, or one with hidden characters', () => {
    expect(messageFor({ funderName: '   ' })).toBe(exportMessages.funderName);
    for (const funderName of ['North\nfield', 'North\u200bfield', 'North\u202efield']) {
      expect(messageFor({ funderName })).toBe(exportMessages.hiddenCharacters);
    }
  });

  it('refuse a prefix 360Giving would not give', () => {
    for (const identifierPrefix of ['360G', '360G-', 'GB-CHC-1234567', '360G-north field']) {
      expect(messageFor({ identifierPrefix }), identifierPrefix).toBe(
        exportMessages.identifierPrefix,
      );
    }
  });

  it('refuse values past the database’s limits and fields they do not name', () => {
    expect(messageFor({ funderIdentifier: `GB-CHC-${'1'.repeat(94)}` })).toBeDefined();
    expect(messageFor({ funderName: 'N'.repeat(201) })).toBeDefined();
    expect(messageFor({ identifierPrefix: `360G-${'n'.repeat(46)}` })).toBeDefined();
    expect(publisherSettingInputSchema.safeParse({ ...valid, tenantId: 'x' }).success).toBe(false);
  });

  it('answer null until saved', () => {
    expect(publisherAnswerSchema.parse({ publisher: null })).toEqual({ publisher: null });
  });

  it('have their own configuration entity type', () => {
    expect(publisherSettingConfigEntityType).toBe('grants.publisher_setting');
    expect([...grantsConfigEntityTypes, ...configEntityTypes, formConfigEntityType]).not.toContain(
      publisherSettingConfigEntityType,
    );
  });
});
