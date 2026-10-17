// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IdentifierScheme } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import { buildExport, ExportInvalid, type AwardRow } from './build.ts';

const publisher = {
  funderIdentifier: 'GB-CHC-7654321',
  funderName: 'Northfield Foundation',
  identifierPrefix: '360G-northfield',
};

const organisationId = '5d1c2b7a-3e4f-4a8b-9c0d-1e2f3a4b5c6d';
const applicationId = '0b3f6b1e-6d2a-4c47-9a51-2f0a3c1d9e10';

const row: AwardRow = {
  application_id: applicationId,
  organisation_id: organisationId,
  amount_minor: '2500050',
  currency: 'GBP',
  released_at: new Date('2027-05-14T23:30:00Z'),
  decision_updated_at: new Date('2027-05-14T23:30:00Z'),
  round_title: 'Spring 2027',
  round_updated_at: new Date('2027-05-20T08:00:00Z'),
  programme_title: 'Community grants',
  programme_summary: 'Small grants for community groups.',
  programme_updated_at: new Date('2027-01-01T00:00:00Z'),
};

const organisation = (
  name: string,
  identifiers: { scheme: IdentifierScheme; identifier: string }[] = [],
) =>
  new Map([
    [
      organisationId,
      {
        id: organisationId,
        name,
        identifiers: identifiers.map((held) => ({ ...held, verified: true })),
      },
    ],
  ]);

describe('buildExport', () => {
  it('builds one grant from the award, writing the day in the tenant time zone', () => {
    const { file, summary } = buildExport(
      [row],
      publisher,
      organisation('Riverside Food Bank', [{ scheme: 'GB-CHC', identifier: '1234567' }]),
      'Europe/London',
    );

    expect(file.grants).toEqual([
      {
        id: `360G-northfield-${applicationId}`,
        title: 'Spring 2027',
        description: 'Small grants for community groups.',
        currency: 'GBP',
        amountAwarded: 25000.5,
        awardDate: '2027-05-15',
        recipientOrganization: [
          { id: 'GB-CHC-1234567', name: 'Riverside Food Bank', charityNumber: '1234567' },
        ],
        fundingOrganization: [{ id: 'GB-CHC-7654321', name: 'Northfield Foundation' }],
        grantProgramme: [{ title: 'Community grants' }],
        dateModified: '2027-05-20T08:00:00.000Z',
      },
    ]);
    expect(summary).toEqual({ grants: 1, unverifiedRecipients: [] });
  });

  it('publishes an organisation with no identifier under the prefix, and names it once as unverified', () => {
    const other = { ...row, application_id: '7a1f6b1e-6d2a-4c47-9a51-2f0a3c1d9e11' };
    const { file, summary } = buildExport(
      [row, other],
      publisher,
      organisation('Riverside Food Bank'),
      'Europe/London',
    );

    expect(file.grants.map((grant) => grant.recipientOrganization[0]?.id)).toEqual([
      `360G-northfield-${organisationId}`,
      `360G-northfield-${organisationId}`,
    ]);
    expect(summary.unverifiedRecipients).toEqual([
      { id: organisationId, name: 'Riverside Food Bank' },
    ]);
  });

  it('keeps a hostile organisation name as text in the JSON', () => {
    const name = `"}],"grants":[{"x":1}]}<script>alert('é')</script>\\`;
    const { file } = buildExport([row], publisher, organisation(name), 'Europe/London');

    const parsed = JSON.parse(JSON.stringify(file)) as typeof file;
    expect(parsed.grants).toHaveLength(1);
    expect(parsed.grants[0]?.recipientOrganization[0]?.name).toBe(name);
  });

  it('fails the whole file, with a code and no value, when a grant does not match the schema', () => {
    const bad = [
      { ...row, amount_minor: null },
      { ...row, released_at: null },
      { ...row, programme_summary: 'x'.repeat(301) },
    ];
    for (const award of bad) {
      expect(() =>
        buildExport([row, award], publisher, organisation('Riverside Food Bank'), 'Europe/London'),
      ).toThrow(ExportInvalid);
    }
    const failure = new ExportInvalid();
    expect(failure.code).toBe('export_invalid');
    expect(failure.message).not.toContain('Riverside');
    expect(() => buildExport([row], publisher, new Map(), 'Europe/London')).toThrow(ExportInvalid);
  });
});
