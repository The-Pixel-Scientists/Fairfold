// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { addressFor, reviewerKindsToCover, searchAddresses } from './addresses.ts';

const id = '3f6c1a52-8d0e-4b7a-9c21-5e4d3b2a1f00';

describe('search addresses', () => {
  it('gives every kind a reviewer reaches an address or a reason it has none', () => {
    for (const kind of reviewerKindsToCover) expect(searchAddresses).toHaveProperty([kind]);
  });

  it('opens an application at an address that holds its id only', () => {
    expect(addressFor('grants.application', id)).toBe(`/submissions/${id}`);
  });

  it('has no address for an excluded or unknown kind, so its results are not shown', () => {
    expect(addressFor('party.person', id)).toBeNull();
    expect(addressFor('made.up', id)).toBeNull();
  });

  it('says why each excluded kind has no page', () => {
    for (const address of Object.values(searchAddresses)) {
      if (typeof address !== 'function') expect(address.excluded).not.toBe('');
    }
  });
});
