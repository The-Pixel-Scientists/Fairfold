// SPDX-License-Identifier: AGPL-3.0-or-later

import { identifierSchemes } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import {
  registries,
  registryIds,
  registryResultClassification,
  registryResultSchema,
} from './registry.ts';

const result = {
  registry: 'charity_commission',
  identifier: '1234567',
  fetchedAt: '2026-11-11T09:00:00.000Z',
  status: 'registered',
  registeredName: 'Riverside Community Trust',
  registeredAddress: {
    line1: '1 Example Street',
    line2: null,
    town: 'Exampleton',
    postcode: 'ZZ1 1ZZ',
    countryCode: 'GB',
  },
  registeredOn: '2001-04-01',
  removedOn: null,
  accounts: {
    periodEnd: '2026-03-31',
    income: { amountMinor: 12_500_000, currency: 'GBP' },
    expenditure: null,
  },
  accountsOverdue: null,
  officers: [{ name: 'Alex Example', role: 'trustee' }],
};

describe('registries', () => {
  it('each serve one party identifier scheme', () => {
    expect(registryIds).toEqual(['charity_commission', 'companies_house', 'oscr', 'ccni']);
    for (const scheme of Object.values(registries))
      expect(identifierSchemes).toHaveProperty(scheme);
  });
});

describe('the normalised result', () => {
  it('takes a found entry', () => {
    expect(registryResultSchema.parse(result)).toEqual(result);
  });

  it("checks the identifier against the register's scheme", () => {
    for (const [registry, identifier] of [
      ['charity_commission', 'SC012345'],
      ['oscr', '1234567'],
      ['ccni', 'NIC100123'],
      ['companies_house', '1234'],
    ]) {
      expect(registryResultSchema.safeParse({ ...result, registry, identifier }).success).toBe(
        false,
      );
    }
    for (const [registry, identifier] of [
      ['oscr', 'SC012345'],
      ['ccni', '100123'],
      ['companies_house', '01234567'],
    ]) {
      expect(registryResultSchema.safeParse({ ...result, registry, identifier }).success).toBe(
        true,
      );
    }
  });

  it('refuses anything else, including more about officers', () => {
    for (const bad of [
      { ...result, raw: '{}' },
      { ...result, link: 'https://example.org' },
      { ...result, officers: [{ name: 'Alex Example', role: 'trustee', dateOfBirth: '1970-01' }] },
      { ...result, officers: [{ name: 'Alex Example', role: 'chair' }] },
      { ...result, status: 'Registered' },
      { ...result, registeredName: 'Riverside\u202ETrust' },
      { ...result, registeredName: '  ' },
      {
        ...result,
        accounts: { ...result.accounts, income: { amountMinor: 12.5, currency: 'GBP' } },
      },
      { ...result, accounts: { ...result.accounts, income: { amountMinor: -1, currency: 'GBP' } } },
    ]) {
      expect(registryResultSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('classifies every field, with addresses and officers personal', () => {
    expect(Object.keys(registryResultClassification).sort()).toEqual(
      Object.keys(registryResultSchema.shape).sort(),
    );
    expect(
      Object.entries(registryResultClassification)
        .filter(([, level]) => level === 'personal')
        .map(([field]) => field),
    ).toEqual(['registeredAddress', 'officers']);
  });
});
