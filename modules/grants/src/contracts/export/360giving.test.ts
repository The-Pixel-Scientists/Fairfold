// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  amountAwarded,
  grantIdentifier,
  MAX_EXPORT_GRANTS,
  recipientOrganization,
  threeSixtyGivingExportSchema,
  threeSixtyGivingFileSchema,
  threeSixtyGivingGrantSchema,
  threeSixtyGivingQuerySchema,
  type ThreeSixtyGivingGrant,
} from './360giving.ts';
import { exportMessages } from './messages.ts';

const applicationId = '0b3f6b1e-6d2a-4c47-9a51-2f0a3c1d9e10';
const organisationId = '5d1c2b7a-3e4f-4a8b-9c0d-1e2f3a4b5c6d';
const prefix = '360G-northfield';

const grant: ThreeSixtyGivingGrant = {
  id: grantIdentifier(prefix, applicationId),
  title: 'Community grants, spring 2027',
  description: 'Small grants for community groups in the north.',
  currency: 'GBP',
  amountAwarded: 25000.5,
  awardDate: '2027-05-14',
  recipientOrganization: [
    { id: 'GB-CHC-1234567', name: 'Riverside Food Bank', charityNumber: '1234567' },
  ],
  fundingOrganization: [{ id: 'GB-CHC-7654321', name: 'Northfield Foundation' }],
  grantProgramme: [{ title: 'Community grants' }],
  dateModified: '2027-05-14T09:30:00.000Z',
};

describe('the 360Giving schemas', () => {
  it('take a grant with the fields we publish', () => {
    expect(threeSixtyGivingGrantSchema.parse(grant)).toEqual(grant);
    expect(threeSixtyGivingFileSchema.parse({ grants: [grant] })).toEqual({ grants: [grant] });
  });

  it('are strict: a field we do not publish fails the file, at any depth', () => {
    for (const extra of [
      { ...grant, plannedDates: [] },
      { ...grant, beneficiaryLocation: [{ name: 'Leeds' }] },
      {
        ...grant,
        recipientOrganization: [{ ...grant.recipientOrganization[0], postalCode: 'LS1 1AA' }],
      },
      { ...grant, fundingOrganization: [{ ...grant.fundingOrganization[0], email: 'a@b.test' }] },
      { ...grant, grantProgramme: [{ title: 'Community grants', code: 'x' }] },
    ]) {
      expect(threeSixtyGivingGrantSchema.safeParse(extra).success).toBe(false);
    }
    expect(threeSixtyGivingFileSchema.safeParse({ grants: [], license: 'x' }).success).toBe(false);
    const summary = { grants: 0, unverifiedRecipients: [] };
    const answer = { file: { grants: [] }, summary };
    expect(threeSixtyGivingExportSchema.parse(answer)).toEqual(answer);
    expect(
      threeSixtyGivingExportSchema.safeParse({ ...answer, summary: { ...summary, total: 1 } })
        .success,
    ).toBe(false);
  });

  it('need every required field, one recipient, funder and programme, and a positive amount', () => {
    for (const key of Object.keys(grant)) {
      const without = Object.fromEntries(Object.entries(grant).filter(([other]) => other !== key));
      expect(threeSixtyGivingGrantSchema.safeParse(without).success, key).toBe(false);
    }
    for (const change of [
      { recipientOrganization: [] },
      { fundingOrganization: [...grant.fundingOrganization, ...grant.fundingOrganization] },
      { grantProgramme: [] },
      { amountAwarded: 0 },
      { currency: 'EUR' },
      { awardDate: '14/05/2027' },
      { dateModified: '2027-05-14' },
      { id: '360G-northfield x' },
      { title: '' },
    ]) {
      expect(threeSixtyGivingGrantSchema.safeParse({ ...grant, ...change }).success).toBe(false);
    }
  });

  it('hold at most MAX_EXPORT_GRANTS grants in a file', () => {
    const grants = Array.from({ length: MAX_EXPORT_GRANTS + 1 }, () => grant);
    expect(threeSixtyGivingFileSchema.safeParse({ grants }).success).toBe(false);
    expect(threeSixtyGivingFileSchema.safeParse({ grants: grants.slice(1) }).success).toBe(true);
  });

  it('take a programme or a round, not both or neither', () => {
    expect(threeSixtyGivingQuerySchema.parse({ programmeId: organisationId })).toEqual({
      programmeId: organisationId,
    });
    expect(threeSixtyGivingQuerySchema.parse({ roundId: organisationId })).toEqual({
      roundId: organisationId,
    });
    for (const query of [{}, { programmeId: organisationId, roundId: organisationId }]) {
      const result = threeSixtyGivingQuerySchema.safeParse(query);
      expect(result.error?.issues[0]?.message).toBe(exportMessages.programmeOrRound);
    }
    expect(threeSixtyGivingQuerySchema.safeParse({ tenantId: organisationId }).success).toBe(false);
  });
});

describe('grantIdentifier', () => {
  it('is the publisher’s prefix and the application’s id', () => {
    expect(grantIdentifier(prefix, applicationId)).toBe(`360G-northfield-${applicationId}`);
  });
});

describe('amountAwarded', () => {
  it('writes minor units as pounds', () => {
    expect(amountAwarded({ amountMinor: 2500050, currency: 'GBP' })).toBe(25000.5);
    expect(amountAwarded({ amountMinor: 1, currency: 'GBP' })).toBe(0.01);
    expect(JSON.stringify(amountAwarded({ amountMinor: 1234567, currency: 'GBP' }))).toBe(
      '12345.67',
    );
  });
});

describe('recipientOrganization', () => {
  const organisation = { id: organisationId, name: 'Riverside Food Bank' };

  it('uses the first identifier in scheme order, verified or not', () => {
    const identifiers = [
      { scheme: 'GB-COH', identifier: '01234567', verified: true },
      { scheme: 'GB-SC', identifier: 'SC012345', verified: false },
    ] as const;
    expect(
      recipientOrganization(prefix, { ...organisation, identifiers: [...identifiers] }),
    ).toEqual({
      recipient: {
        id: 'GB-SC-SC012345',
        name: 'Riverside Food Bank',
        charityNumber: 'SC012345',
        companyNumber: '01234567',
      },
      verified: false,
    });
    const chc = { scheme: 'GB-CHC', identifier: '1234567', verified: true } as const;
    expect(
      recipientOrganization(prefix, { ...organisation, identifiers: [...identifiers, chc] }),
    ).toMatchObject({
      recipient: { id: 'GB-CHC-1234567', charityNumber: '1234567' },
      verified: true,
    });
  });

  it('publishes a society under its register number, with no charity or company number', () => {
    const identifiers = [{ scheme: 'GB-MPR', identifier: 'RS001234', verified: true }] as const;
    expect(
      recipientOrganization(prefix, { ...organisation, identifiers: [...identifiers] }),
    ).toEqual({
      recipient: { id: 'GB-MPR-RS001234', name: 'Riverside Food Bank' },
      verified: true,
    });
  });

  it('falls back to the prefix and the organisation’s id, as unverified', () => {
    expect(recipientOrganization(prefix, { ...organisation, identifiers: [] })).toEqual({
      recipient: { id: `360G-northfield-${organisationId}`, name: 'Riverside Food Bank' },
      verified: false,
    });
  });

  it('gives what the grant schema takes', () => {
    const { recipient } = recipientOrganization(prefix, { ...organisation, identifiers: [] });
    const built = { ...grant, recipientOrganization: [recipient] };
    expect(threeSixtyGivingGrantSchema.parse(built)).toEqual(built);
  });
});
