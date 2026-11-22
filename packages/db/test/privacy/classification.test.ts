// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Breach, assessment and DPIA text can name the people a breach or a DPIA is
// about, though no column links them to a person. Neither way round a missing
// subject path is allowed: lowering these columns' class, or calling the
// tables unlinked, which would cut their retention to 12 months.

import { describe, expect, it } from 'vitest';

import { classification, subjectPaths } from '../../classification.ts';

const FREE_TEXT = [
  ['privacy.rights_request', 'summary'],
  ['privacy.breach', 'description'],
  ['privacy.breach', 'consequences'],
  ['privacy.breach_assessment', 'rationale'],
  ['privacy.dpia', 'dpo_advice'],
] as const;

describe('privacy classification', () => {
  it.each(FREE_TEXT)('keeps %s.%s special category', (table, column) => {
    expect(classification[table]?.[column]?.sensitivity).toBe('special_category');
  });

  it.each(['privacy.breach', 'privacy.breach_assessment', 'privacy.dpia'])(
    'does not mark %s unlinked',
    (table) => {
      expect(subjectPaths[table]?.kind).not.toBe('unlinked');
    },
  );
});
