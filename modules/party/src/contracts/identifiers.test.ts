// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue, messages } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import {
  identifierInputSchema,
  identifierSchemeIds,
  type IdentifierScheme,
} from './identifiers.ts';
import { partyMessages } from './messages.ts';

function parse(scheme: string, identifier: unknown) {
  return identifierInputSchema.safeParse({ scheme, identifier });
}

const valid: Record<IdentifierScheme, [typed: string, stored: string][]> = {
  'GB-CHC': [
    ['1234567', '1234567'],
    ['202918', '202918'],
    [' 1 234 567 ', '1234567'],
  ],
  'GB-SC': [
    ['SC012345', 'SC012345'],
    ['sc 012345', 'SC012345'],
  ],
  'GB-NIC': [
    ['100123', '100123'],
    ['NIC100123', '100123'],
    ['nic 100 123', '100123'],
  ],
  'GB-COH': [
    ['01234567', '01234567'],
    ['1234567', '01234567'],
    ['sc123456', 'SC123456'],
    ['OC301234', 'OC301234'],
    ['NI012345', 'NI012345'],
    ['R0012345', 'R0012345'],
  ],
  'GB-MPR': [
    ['12345R', '12345R'],
    ['IP 12345R', 'IP12345R'],
    ['RS001234', 'RS001234'],
    ['2468R(S)', '2468R(S)'],
    ['525', '525'],
  ],
};

const invalid: Record<IdentifierScheme, string[]> = {
  'GB-CHC': ['12345', '0123456', '2234567', '12345678', '1234567-1', 'SC012345', ''],
  'GB-SC': ['012345', 'SC12345', 'SC0123456', 'SX012345', ''],
  'GB-NIC': ['10012', '200123', 'NI100123', '1001234', ''],
  'GB-COH': ['123456', '123456789', 'S1234567', 'SC12345', 'SCO12345', ''],
  'GB-MPR': ['R', 'ABC123', '1234567', '12-345', ''],
};

const message: Record<IdentifierScheme, string> = {
  'GB-CHC': partyMessages.charityNumber,
  'GB-SC': partyMessages.scottishCharityNumber,
  'GB-NIC': partyMessages.northernIrishCharityNumber,
  'GB-COH': partyMessages.companyNumber,
  'GB-MPR': partyMessages.societyNumber,
};

describe('identifiers', () => {
  it('cover the org-id.guide schemes in MVP1', () => {
    expect(identifierSchemeIds).toEqual(['GB-CHC', 'GB-SC', 'GB-NIC', 'GB-COH', 'GB-MPR']);
  });

  it.each(identifierSchemeIds)('store %s numbers as the register writes them', (scheme) => {
    for (const [typed, stored] of valid[scheme]) {
      expect(parse(scheme, typed).data, typed).toEqual({ scheme, identifier: stored });
    }
  });

  it.each(identifierSchemeIds)(
    'refuse %s numbers in the wrong form, saying how to fix them',
    (scheme) => {
      for (const typed of invalid[scheme]) {
        const result = parse(scheme, typed);
        expect(result.success, typed).toBe(false);
        const issue = result.error?.issues[0];
        expect(issue?.path).toEqual(['identifier']);
        expect(messageForIssue(issue ?? {})).toBe(message[scheme]);
      }
    },
  );

  it('refuse an unknown scheme, a missing number and extra keys', () => {
    const scheme = parse('GB-XYZ', '1234567');
    expect(messageForIssue(scheme.error?.issues[0] ?? {})).toBe(messages.chooseAllowedValue);
    expect(parse('GB-CHC', undefined).success).toBe(false);
    expect(parse('GB-CHC', 'x'.repeat(31)).success).toBe(false);
    const extra = { scheme: 'GB-CHC', identifier: '1234567', verified: true };
    expect(identifierInputSchema.safeParse(extra).success).toBe(false);
  });
});
