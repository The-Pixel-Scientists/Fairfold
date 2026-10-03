// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messages } from './messages.ts';
import { reservedSlugs, slugPattern, slugSchema } from './tenant.ts';

describe('slugSchema', () => {
  it('takes 3 to 40 lower case letters, digits and single hyphens, starting with a letter', () => {
    for (const slug of ['northfield', 'abc', 'east-riding-trust', 'trust2026', 'a'.repeat(40)]) {
      expect(slugSchema.safeParse(slug).success).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const slug of [
      'ab',
      'a'.repeat(41),
      'Northfield',
      '2026trust',
      'north--field',
      'northfield-',
      '-northfield',
      'north_field',
      'north field',
      'nörthfield',
    ]) {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    }
  });

  it('reserves the top-level routes the apps serve outside any tenant', () => {
    // Console: /dev/components. Portal: /how-applying-works.
    for (const segment of ['dev', 'how-applying-works']) expect(reservedSlugs).toContain(segment);
  });

  it('refuses the reserved names, which the pattern alone would allow', () => {
    for (const slug of reservedSlugs) {
      expect(slugPattern.test(slug)).toBe(true);
      const result = slugSchema.safeParse(slug);
      expect(result.error?.issues[0]?.message).toBe(messages.slugReserved);
    }
  });
});
