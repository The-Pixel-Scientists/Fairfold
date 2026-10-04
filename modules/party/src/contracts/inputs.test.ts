// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  addressInputSchema,
  consentChangeSchema,
  organisationInputSchema,
  organisationQuerySchema,
  profileInputSchema,
} from './inputs.ts';
import { partyMessages } from './messages.ts';

const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const address = { line1: '1 High Street', town: 'Northfield', postcode: 'sw1a1aa' };

const organisation = {
  name: 'Northfield Community Garden',
  legalForm: 'charitable_incorporated_organisation',
  identifiers: [{ scheme: 'GB-CHC', identifier: '1234567' }],
  registeredAddress: address,
  website: 'https://example.org',
};

const profile = { givenName: 'Ada', familyName: 'Lovelace' };

const consentChange = {
  purpose: 'future_funding',
  channel: 'email',
  state: 'given',
  privacyNoticeVersion: '2026-10-01',
};

/** Each problem's message, by where it is. */
function problems(schema: z.ZodType, value: unknown): Record<string, string> {
  const result = schema.safeParse(value);
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), messageForIssue(issue)]),
  );
}

describe('organisation input', () => {
  it('normalises the postcode and defaults the country to GB', () => {
    expect(organisationInputSchema.parse(organisation).registeredAddress).toEqual({
      ...address,
      postcode: 'SW1A 1AA',
      countryCode: 'GB',
    });
  });

  it('checks a UK postcode only for an address in GB', () => {
    for (const postcode of ['M1 1AE', 'b33 8th', 'CR2 6XH', 'DN55 1PT', 'W1A 0AX', 'EC1A 1BB']) {
      expect(addressInputSchema.safeParse({ ...address, postcode }).success, postcode).toBe(true);
    }
    for (const postcode of ['SW1A', '12345', 'SW1A 1A', '1AA 1AA', '']) {
      expect(problems(addressInputSchema, { ...address, postcode }), postcode).toEqual({
        postcode: partyMessages.postcode,
      });
    }
    const abroad = { ...address, postcode: 'D02  X285', countryCode: 'ie' };
    expect(addressInputSchema.parse(abroad)).toMatchObject({
      postcode: 'D02 X285',
      countryCode: 'IE',
    });
    expect(problems(addressInputSchema, { ...abroad, postcode: ' ' })).toEqual({
      postcode: partyMessages.postcodeAbroad,
    });
    expect(problems(addressInputSchema, { ...address, countryCode: 'GBR' })).toEqual({
      countryCode: partyMessages.countryCode,
    });
  });

  it('takes an https website only, stored as parsed, and a blank one as none', () => {
    for (const [website, stored] of [
      ['https://example.org', 'https://example.org/'],
      [' HTTPS://WWW.Example.org/about?x=1 ', 'https://www.example.org/about?x=1'],
      ['https://café.example/menu', 'https://xn--caf-dma.example/menu'],
      ['', ''],
    ]) {
      expect(organisationInputSchema.parse({ ...organisation, website }).website).toBe(stored);
    }
    const withoutWebsite: Partial<typeof organisation> = { ...organisation };
    delete withoutWebsite.website;
    expect(organisationInputSchema.safeParse(withoutWebsite).success).toBe(true);
    for (const website of [
      'http://example.org',
      'example.org',
      'javascript:alert(1)',
      'https://localhost',
      'https://user:secret@example.org',
      'https://exa\tmple.org',
      'https://example.org/\n<script>',
      'https://example.org/a b',
      'https://example.org/"onmouseover=x',
      'https://example.org/<b>',
      'https://example.org/a​b',
      'https:example.org',
      'https:/example.org',
      'https:\\\\example.org',
    ]) {
      expect(problems(organisationInputSchema, { ...organisation, website }), website).toEqual({
        website: partyMessages.website,
      });
    }
    const longOnceEncoded = `https://example.org/${'é'.repeat(100)}`;
    expect(longOnceEncoded.length).toBeLessThan(200);
    expect(
      Object.keys(problems(organisationInputSchema, { ...organisation, website: longOnceEncoded })),
    ).toEqual(['website']);
  });

  it('needs a name, a known legal form and plain text', () => {
    expect(problems(organisationInputSchema, { ...organisation, name: '  ' })).toEqual({
      name: partyMessages.organisationName,
    });
    expect(problems(organisationInputSchema, { ...organisation, name: 'A\u202EB' })).toEqual({
      name: partyMessages.hiddenCharacters,
    });
    const trust = { ...organisation, legalForm: 'trust' };
    expect(organisationInputSchema.safeParse(trust).success).toBe(false);
  });

  it('takes no identifier, or one of each scheme', () => {
    const none = { ...organisation, identifiers: [] };
    expect(organisationInputSchema.safeParse(none).success).toBe(true);
    const identifiers = [
      { scheme: 'GB-CHC', identifier: '1234567' },
      { scheme: 'GB-CHC', identifier: '1765432' },
    ];
    expect(problems(organisationInputSchema, { ...organisation, identifiers })).toEqual({
      identifiers: partyMessages.identifierOncePerType,
    });
  });
});

describe('profile and consent input', () => {
  it('takes names and an optional phone number', () => {
    const input = { givenName: ' Ada ', familyName: 'Lovelace', phone: '01632 960 001' };
    expect(profileInputSchema.parse(input)).toEqual({ ...input, givenName: 'Ada' });
    for (const phone of ['+44 7700 900 982', '(01632) 960-001', '']) {
      expect(profileInputSchema.safeParse({ ...profile, phone }).success, phone).toBe(true);
    }
    for (const phone of ['12345', '01632 960 001 ext 2', '+44 7700 900 982 1234 5']) {
      expect(problems(profileInputSchema, { ...profile, phone }), phone).toEqual({
        phone: partyMessages.phone,
      });
    }
    expect(problems(profileInputSchema, { ...profile, givenName: '' })).toEqual({
      givenName: partyMessages.givenName,
    });
  });

  it('offers email only in the portal', () => {
    expect(consentChangeSchema.parse(consentChange)).toEqual(consentChange);
    for (const change of [
      { channel: 'sms' },
      { state: 'maybe' },
      { purpose: 'marketing' },
      { privacyNoticeVersion: '' },
    ]) {
      expect(consentChangeSchema.safeParse({ ...consentChange, ...change }).success).toBe(false);
    }
  });
});

describe('strict inputs', () => {
  it('refuse keys they do not name, such as ids, an email address or verification', () => {
    const inputs: [z.ZodType, object][] = [
      [profileInputSchema, profile],
      [consentChangeSchema, consentChange],
      [organisationInputSchema, organisation],
      [addressInputSchema, address],
      [organisationQuerySchema, {}],
    ];
    for (const [schema, value] of inputs) {
      expect(schema.safeParse(value).success).toBe(true);
      for (const extra of [{ personId: id }, { email: 'a@example.org' }, { verified: true }]) {
        expect(schema.safeParse({ ...value, ...extra }).success).toBe(false);
      }
    }
  });
});
