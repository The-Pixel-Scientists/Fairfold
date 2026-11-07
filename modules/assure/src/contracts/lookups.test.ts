// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import {
  listOrganisationLookups,
  lookupRefreshInputSchema,
  lookupSnapshotSchema,
  officerLinkInputSchema,
} from './lookups.ts';
import { assureMessages } from './messages.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('lookups', () => {
  it('refresh an identifier the organisation claims, by register only', () => {
    expect(lookupRefreshInputSchema.parse({ registry: 'oscr' })).toEqual({ registry: 'oscr' });
    for (const bad of [
      { registry: 'oscr', identifier: 'SC012345' },
      { registry: 'oscr', url: 'https://example.org' },
      {},
    ]) {
      expect(lookupRefreshInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const result = lookupRefreshInputSchema.safeParse({ registry: 'opencorporates' });
    expect(result.error?.issues.map(messageForIssue)).toEqual([assureMessages.registry]);
  });

  it('show source and date, and leave officers to their own read', () => {
    expect(listOrganisationLookups.responses[200].shape.snapshots.element).toBe(
      lookupSnapshotSchema,
    );
    expect(Object.keys(lookupSnapshotSchema.shape)).toEqual(
      expect.arrayContaining(['registry', 'fetchedAt']),
    );
    expect(lookupSnapshotSchema.shape.details.unwrap().shape).not.toHaveProperty('officers');
  });

  it('link an officer to a person, and nothing more', () => {
    expect(officerLinkInputSchema.safeParse({ personId: ID }).success).toBe(true);
    expect(officerLinkInputSchema.safeParse({ personId: ID, verified: true }).success).toBe(false);
  });
});
