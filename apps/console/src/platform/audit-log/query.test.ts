// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { draftOf, filtersFrom, filtersSchema, isFiltered, searchOf } from './query.ts';

const ID = '0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10';

describe('the filters in the address', () => {
  it('writes only the filters set, in a fixed order, and nothing when none are', () => {
    expect(searchOf({})).toBe('');
    expect(searchOf({ to: '2026-10-31', module: 'grants', from: '2026-10-01' })).toBe(
      '?module=grants&from=2026-10-01&to=2026-10-31',
    );
  });

  it('reads the contract, refusing a key it does not have and the page cursor', () => {
    expect(filtersSchema.safeParse({ module: 'grants' }).success).toBe(true);
    expect(filtersSchema.safeParse({ module: 'unknown' }).success).toBe(false);
    expect(filtersSchema.safeParse({ cursor: 'abc' }).success).toBe(false);
    expect(filtersSchema.safeParse({ sort: 'asc' }).success).toBe(false);
  });

  it('says whether any filter is set', () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ entityId: ID })).toBe(true);
  });
});

describe('a draft of the filters', () => {
  it('turns the fields into filters, leaving out the empty ones', () => {
    const draft = { ...draftOf({}), module: 'grants', from: '2026-10-01' };
    expect(filtersFrom(draft)).toEqual({
      ok: true,
      filters: { module: 'grants', from: '2026-10-01' },
    });
    expect(draftOf({ entityId: ID }).entityId).toBe(ID);
  });

  it('says what is wrong next to the field', () => {
    const result = filtersFrom({ ...draftOf({}), entityId: 'abc', from: '14/10/2026' });
    expect(result).toEqual({
      ok: false,
      errors: {
        entityId: 'Enter the whole ID, such as 0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10.',
        from: 'Enter a date, such as 14 October 2026.',
      },
    });
  });

  it('refuses an end date before the start date', () => {
    const result = filtersFrom({ ...draftOf({}), from: '2026-10-14', to: '2026-10-13' });
    expect(result).toEqual({
      ok: false,
      errors: { to: 'Enter an end date on or after the start date.' },
    });
    expect(filtersFrom({ ...draftOf({}), from: '2026-10-14', to: '2026-10-14' }).ok).toBe(true);
  });
});
