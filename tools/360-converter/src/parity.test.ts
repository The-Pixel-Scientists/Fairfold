// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The converter and the grants export write the same JSON for the same
// synthetic grants. The export's builder is loaded from the module's server
// code, which only tests may import.

import { describe, expect, it } from 'vitest';

import { buildExport, type AwardRow } from '../../../modules/grants/src/server/export/build.ts';
import { columns, convert } from './convert.ts';

const publisher = {
  funderName: 'Northfield Foundation',
  funderIdentifier: 'GB-CHC-7654321',
  identifierPrefix: '360G-northfield',
};

const award = (applicationId: string, organisationId: string, amountMinor: string): AwardRow => ({
  application_id: applicationId,
  organisation_id: organisationId,
  amount_minor: amountMinor,
  currency: 'GBP',
  released_at: new Date('2027-05-14T10:00:00Z'),
  decision_updated_at: new Date('2027-05-14T10:00:00Z'),
  round_title: 'Spring 2027',
  round_updated_at: new Date('2027-05-20T08:00:00Z'),
  programme_title: 'Community grants',
  programme_summary: 'Small grants for community groups.',
  programme_updated_at: new Date('2027-01-01T00:00:00Z'),
});

const riverside = {
  id: '5d1c2b7a-3e4f-4a8b-9c0d-1e2f3a4b5c6d',
  name: 'Riverside Food Bank',
  identifiers: [{ scheme: 'GB-CHC' as const, identifier: '1234567', verified: true }],
};
const hillside = {
  id: '6e2d3c8b-4f50-4b9c-8d1e-2f3a4b5c6d7e',
  name: 'Hillside "Community" Hub',
  identifiers: [{ scheme: 'GB-SC' as const, identifier: 'SC012345', verified: true }],
};

/** The award as a CSV row, as a funder would type it. */
function line(reference: string, amount: string, organisation: typeof riverside | typeof hillside) {
  const [held] = organisation.identifiers;
  const values: Record<(typeof columns)[number], string> = {
    'Grant reference': reference,
    Title: 'Spring 2027',
    Description: 'Small grants for community groups.',
    Amount: amount,
    Currency: 'GBP',
    'Award date': '2027-05-14',
    'Recipient organisation name': organisation.name,
    'Recipient identifier': held?.identifier ?? '',
    'Recipient scheme': held?.scheme ?? '',
    'Programme title': 'Community grants',
  };
  return columns.map((column) => `"${values[column].replaceAll('"', '""')}"`).join(',');
}

describe('the converter and the export', () => {
  it('write the same 360Giving JSON for the same grants', () => {
    const exported = buildExport(
      [
        award('0b3f6b1e-6d2a-4c47-9a51-2f0a3c1d9e10', riverside.id, '2500050'),
        award('7a1f6b1e-6d2a-4c47-9a51-2f0a3c1d9e11', hillside.id, '90000'),
      ],
      publisher,
      new Map([riverside, hillside].map((organisation) => [organisation.id, organisation])),
      'Europe/London',
    );

    const csv = [
      columns.join(','),
      line('0b3f6b1e-6d2a-4c47-9a51-2f0a3c1d9e10', '25000.50', riverside),
      line('7a1f6b1e-6d2a-4c47-9a51-2f0a3c1d9e11', '900', hillside),
    ].join('\n');
    const converted = convert(csv, publisher, '2027-05-20T08:00:00.000Z');

    expect(converted.ok && JSON.stringify(converted.file)).toBe(JSON.stringify(exported.file));
  });
});
