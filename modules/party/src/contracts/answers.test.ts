// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  consoleOrganisationSchema,
  organisationSummarySchema,
  portalOrganisationListSchema,
  portalOrganisationSchema,
  profileSchema,
} from './answers.ts';

const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('answers', () => {
  it('keep verification and contacts out of the portal', () => {
    expect(Object.keys(profileSchema.shape)).toEqual([
      'givenName',
      'familyName',
      'email',
      'phone',
      'consents',
    ]);
    expect(Object.keys(portalOrganisationSchema.shape)).toEqual([
      'id',
      'name',
      'legalForm',
      'identifiers',
      'registeredAddress',
      'website',
    ]);
    const identifier = portalOrganisationSchema.shape.identifiers.element;
    expect(Object.keys(identifier.shape)).toEqual(['scheme', 'identifier']);
    const listed = portalOrganisationListSchema.shape.organisations.element;
    expect(Object.keys(listed.shape)).toEqual(['id', 'name', 'legalForm']);
  });

  it('drop from a portal answer anything else the server holds', () => {
    const stored = {
      id,
      name: 'Northfield Community Garden',
      legalForm: 'other',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1234567', verified: true }],
      registeredAddress: {
        line1: '1 High Street',
        line2: null,
        town: 'Northfield',
        postcode: 'SW1A 1AA',
        countryCode: 'GB',
      },
      website: null,
      contacts: [{ personId: id, givenName: 'Ada', familyName: null, email: 'a@example.org' }],
    };
    const answer = portalOrganisationSchema.parse(stored);
    expect(answer).not.toHaveProperty('contacts');
    expect(answer.identifiers).toEqual([{ scheme: 'GB-CHC', identifier: '1234567' }]);
  });

  it('show staff each identifier as verified or unverified, and the contacts', () => {
    const identifier = organisationSummarySchema.shape.identifiers.element;
    expect(Object.keys(identifier.shape)).toEqual(['scheme', 'identifier', 'verified']);
    expect(Object.keys(consoleOrganisationSchema.shape)).toContain('contacts');
  });
});
