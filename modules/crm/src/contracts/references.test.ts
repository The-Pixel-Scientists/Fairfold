// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { crmMessages } from './messages.ts';
import { externalReferenceInputSchema, isExternalUrl } from './references.ts';

const messageAt = (input: unknown) =>
  externalReferenceInputSchema.safeParse(input).error?.issues.map((issue) => issue.message);

describe('external references', () => {
  it('take a system, a plain id and an optional https link', () => {
    expect(
      externalReferenceInputSchema.parse({
        system: 'salesforce',
        externalId: ' 0015g00000ABCdE ',
        url: 'https://example.org/records/0015',
      }),
    ).toEqual({
      system: 'salesforce',
      externalId: '0015g00000ABCdE',
      url: 'https://example.org/records/0015',
    });
    expect(
      externalReferenceInputSchema.parse({ system: 'other', externalId: 'urn:x-1.2_3' }),
    ).toEqual({
      system: 'other',
      externalId: 'urn:x-1.2_3',
    });
  });

  it.each(['', '-leading', 'with space', 'semi;colon', '<script>', 'a'.repeat(101), 'é'])(
    'refuses the id %j',
    (externalId) => {
      expect(messageAt({ system: 'twenty', externalId })).toEqual([crmMessages.externalId]);
    },
  );

  it.each([
    'http://example.org/1',
    'https://user:secret@example.org/1',
    'javascript:alert(1)',
    'https://localhost/1',
    `https://example.org/${'a'.repeat(500)}`,
  ])('refuses the link %j', (url) => {
    expect(isExternalUrl(url)).toBe(false);
    expect(messageAt({ system: 'twenty', externalId: 'abc', url })).toEqual([
      crmMessages.externalUrl,
    ]);
  });

  it('refuses a system not on the list, credentials and sync state', () => {
    expect(messageAt({ system: 'hubspot', externalId: 'abc' })).toEqual([
      crmMessages.externalSystem,
    ]);
    expect(
      externalReferenceInputSchema.safeParse({ system: 'other', externalId: 'abc', token: 'x' })
        .success,
    ).toBe(false);
  });
});
