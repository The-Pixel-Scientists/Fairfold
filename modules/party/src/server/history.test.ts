// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { valueHistoryFields } from '../contracts/index.ts';
import { fieldChanges } from './history.ts';

describe('fieldChanges', () => {
  it('names each changed column by its field id and leaves unchanged ones out', () => {
    const changes = fieldChanges(
      'person',
      { given_name: 'Ada', family_name: 'Byron', phone: null },
      { given_name: 'Ada', family_name: 'Lovelace', phone: '01632 960 001' },
    );

    expect(changes).toEqual([
      { field: 'person.family_name', before: 'Byron', after: 'Lovelace' },
      { field: 'person.phone', before: null, after: '01632 960 001' },
    ]);
  });

  it('keeps nothing when nothing differs, and only field ids the database lists', () => {
    const same = { name: 'Trust', website: null };

    expect(fieldChanges('organisation', same, same)).toEqual([]);
    for (const { field } of fieldChanges('organisation', { name: 'A' }, { name: 'B' })) {
      expect(Object.keys(valueHistoryFields)).toContain(field);
    }
  });
});
