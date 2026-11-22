// SPDX-License-Identifier: AGPL-3.0-or-later
//
// All data here is synthetic: the funder, recipients and registered numbers
// are made up.

import { threeSixtyGivingGrantSchema } from '@pixel-scientists/grants/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { columns, convert, MAX_GRANTS, type Conversion } from './convert.ts';

const publisher = {
  funderName: 'Northfield Foundation',
  funderIdentifier: 'GB-CHC-7654321',
  identifierPrefix: '360G-northfield',
};
const modified = '2027-06-01T09:00:00.000Z';
const header = columns.join(',');

const grant = {
  'Grant reference': 'NF-2027-001',
  Title: 'Spring 2027',
  Description: 'Small grants for community groups.',
  Amount: '25000.50',
  Currency: 'GBP',
  'Award date': '2027-05-14',
  'Recipient organisation name': 'Riverside Food Bank',
  'Recipient identifier': '1234567',
  'Recipient scheme': 'GB-CHC',
  'Programme title': 'Community grants',
};

type Row = Partial<Record<keyof typeof grant, string>>;

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const csv = (...rows: Row[]) =>
  [header, ...rows.map((row) => columns.map((column) => quote(row[column] ?? '')).join(','))]
    .join('\r\n')
    .concat('\r\n');

function problems(result: Conversion): readonly string[] {
  if (result.ok) throw new Error('The conversion passed.');
  return result.problems;
}

function grants(result: Conversion) {
  if (!result.ok) throw new Error(result.problems.join('\n'));
  return result.file.grants;
}

describe('convert', () => {
  it('runs zod without eval, for a browser page', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('builds a 360Giving file that passes the export schema', () => {
    const result = convert(
      csv(grant, {
        ...grant,
        'Grant reference': 'NF-2027-002',
        Amount: '900',
        'Recipient organisation name': 'Hillside Community Hub',
        'Recipient identifier': 'sc 123456',
        'Recipient scheme': 'gb-coh',
      }),
      publisher,
      modified,
    );

    expect(grants(result)).toEqual([
      {
        id: '360G-northfield-NF-2027-001',
        title: 'Spring 2027',
        description: 'Small grants for community groups.',
        currency: 'GBP',
        amountAwarded: 25000.5,
        awardDate: '2027-05-14',
        recipientOrganization: [
          { id: 'GB-CHC-1234567', name: 'Riverside Food Bank', charityNumber: '1234567' },
        ],
        fundingOrganization: [{ id: 'GB-CHC-7654321', name: 'Northfield Foundation' }],
        grantProgramme: [{ title: 'Community grants' }],
        dateModified: modified,
      },
      expect.objectContaining({
        amountAwarded: 900,
        recipientOrganization: [
          { id: 'GB-COH-SC123456', name: 'Hillside Community Hub', companyNumber: 'SC123456' },
        ],
      }),
    ]);
    for (const built of grants(result)) {
      expect(threeSixtyGivingGrantSchema.safeParse(built).success).toBe(true);
    }
    expect(result.ok && result.summary).toEqual({ grants: 2, uncheckedRecipients: 2 });
  });

  it('counts each recipient once, however many grants it has', () => {
    const result = convert(
      csv(grant, { ...grant, 'Grant reference': 'NF-2027-002' }),
      publisher,
      modified,
    );
    expect(result.ok && result.summary).toEqual({ grants: 2, uncheckedRecipients: 1 });
  });

  it('reads columns in any order and header names in any case', () => {
    const reversed = [...columns].reverse();
    const text = `${reversed.map((column) => column.toUpperCase()).join(',')}\n${reversed
      .map((column) => quote(grant[column]))
      .join(',')}\n`;
    expect(grants(convert(text, publisher, modified))).toHaveLength(1);
  });

  it.each([
    ['2500', 2500],
    ['2500.5', 2500.5],
    ['0.01', 0.01],
    ['1234567890123.99', 1234567890123.99],
  ])('reads the amount %s as %d pounds', (amount, pounds) => {
    const [built] = grants(convert(csv({ ...grant, Amount: amount }), publisher, modified));
    expect(built?.amountAwarded).toBe(pounds);
  });

  it.each(['', '0', '0.00', '-5', '2,500', '£2500', '2500.555', '1e3', '.5', '12345678901234'])(
    'refuses the amount %j',
    (amount) => {
      expect(problems(convert(csv({ ...grant, Amount: amount }), publisher, modified))).toEqual([
        'Row 2, Amount: Enter the amount awarded in pounds, more than zero, like 2500 or 2500.50, with no £ sign or commas.',
      ]);
    },
  );

  it('refuses a currency other than GBP, without a second message about the amount', () => {
    expect(
      problems(convert(csv({ ...grant, Currency: 'EUR', Amount: 'lots' }), publisher, modified)),
    ).toEqual(['Row 2, Currency: Enter the currency code GBP.']);
  });

  it.each(['14/05/2027', '2027-13-01', '2027-02-30', '2027-05-14T10:00:00Z', ''])(
    'refuses the award date %j',
    (date) => {
      expect(problems(convert(csv({ ...grant, 'Award date': date }), publisher, modified))).toEqual(
        ['Row 2, Award date: Enter the date of the award as year, month and day, like 2027-05-14.'],
      );
    },
  );

  it('refuses an identifier that does not fit its scheme, with the scheme rule', () => {
    expect(
      problems(convert(csv({ ...grant, 'Recipient identifier': '12' }), publisher, modified)),
    ).toEqual([
      'Row 2, Recipient identifier: Enter a charity number of 6 or 7 digits, like 1234567.',
    ]);
  });

  it('refuses a scheme it does not know', () => {
    expect(
      problems(convert(csv({ ...grant, 'Recipient scheme': 'US-EIN' }), publisher, modified)),
    ).toEqual([
      'Row 2, Recipient scheme: Enter the register the number is from: GB-CHC, GB-SC, GB-NIC, GB-COH or GB-MPR.',
    ]);
  });

  it.each([
    ['no organisation name', { 'Recipient organisation name': '' }],
    ['no scheme', { 'Recipient scheme': '' }],
    [
      'neither',
      { 'Recipient organisation name': '', 'Recipient identifier': '', 'Recipient scheme': '' },
    ],
  ])('refuses a row with %s, as a grant to an individual', (_, row) => {
    expect(
      problems(
        convert(csv(grant, { ...grant, ...row, 'Grant reference': 'NF-2' }), publisher, modified),
      ),
    ).toEqual([
      "Row 3 has no recipient organisation. 360Giving files from this tool cover grants to organisations only. Remove the row or add the organisation's name and charity or company number.",
    ]);
  });

  it('refuses a column for individual recipients', () => {
    const text = `${header},Recipient Ind:Name\n${columns.map((column) => quote(grant[column])).join(',')},A Person\n`;
    expect(problems(convert(text, publisher, modified))).toEqual([
      'Column 11 is for individual recipients. 360Giving files from this tool cover grants to organisations only. Remove the column.',
    ]);
  });

  it('refuses unknown, missing and repeated columns', () => {
    const text = `${columns.slice(1).join(',')},Title,Post${String.fromCharCode(7)}code\n`;
    expect(problems(convert(text, publisher, modified))).toEqual([
      'The file has more than one "Title" column. Keep one.',
      'Column 11, "Postcode", is not in the template. Remove it, or rename it to match template.csv.',
      'The file has no "Grant reference" column. Add it as in template.csv.',
    ]);
  });

  it('refuses a value under no column', () => {
    const text = `${csv(grant).trimEnd()},extra\n`;
    expect(problems(convert(text, publisher, modified))).toEqual([
      'Row 2 has more values than the header row has columns. Remove the extra values, or put quote marks round any value that holds a comma.',
    ]);
  });

  it('refuses a reference used twice, and one with spaces', () => {
    expect(
      problems(
        convert(csv(grant, grant, { ...grant, 'Grant reference': 'NF 3' }), publisher, modified),
      ),
    ).toEqual([
      'Row 3, Grant reference: row 2 has the same reference. Give each grant its own reference.',
      'Row 4, Grant reference: Enter a reference with no spaces, like NF-2027-001. With the prefix, it can be up to 200 characters.',
    ]);
  });

  it('lists every problem in every row, in column order, and never repeats a value', () => {
    const secret = 'Hidden Value 991';
    const result = convert(
      csv(
        grant,
        {
          ...grant,
          Title: secret.repeat(10),
          Amount: secret,
          'Award date': secret,
          'Recipient identifier': secret,
        },
        { ...grant, 'Grant reference': 'NF-2027-003', 'Programme title': '' },
      ),
      publisher,
      modified,
    );
    expect(problems(result)).toEqual([
      'Row 3, Grant reference: row 2 has the same reference. Give each grant its own reference.',
      'Row 3, Title: Enter a title of up to 120 characters.',
      'Row 3, Amount: Enter the amount awarded in pounds, more than zero, like 2500 or 2500.50, with no £ sign or commas.',
      'Row 3, Award date: Enter the date of the award as year, month and day, like 2027-05-14.',
      'Row 3, Recipient identifier: Enter a charity number of 6 or 7 digits, like 1234567.',
      'Row 4, Programme title: Enter a programme title of up to 120 characters.',
    ]);
    expect(problems(result).join('\n')).not.toContain('Hidden');
  });

  it('escapes a hostile organisation name in the JSON and keeps it as written', () => {
    const name = `=HYPERLINK("http://example.test") "Quoted", ${String.fromCharCode(7)}bell +1 @x -y`;
    const [built] = grants(
      convert(csv({ ...grant, 'Recipient organisation name': name }), publisher, modified),
    );
    const json = JSON.stringify({ grants: [built] });
    expect(json).not.toContain(String.fromCharCode(7));
    expect(json).toContain(String.raw`\"Quoted\"`);
    expect(JSON.parse(json)).toEqual({ grants: [built] });
    expect(built?.recipientOrganization[0]?.name).toBe(name);
  });

  it('never publishes an individual recipient', () => {
    const [built] = grants(convert(csv(grant), publisher, modified));
    expect(JSON.stringify(built)).not.toContain('recipientIndividual');
  });

  it('checks the funder details as the export does', () => {
    expect(
      problems(
        convert(
          csv(grant),
          { funderName: '', funderIdentifier: 'Northfield', identifierPrefix: 'northfield' },
          modified,
        ),
      ),
    ).toEqual([
      "Funder identifier: Enter the funder's identifier from org-id.guide, like GB-CHC-1234567.",
      "Funder name: Enter the funder's name as it should be published.",
      'Identifier prefix: Enter the prefix 360Giving gave the funder, like 360G-northfield.',
    ]);
  });

  it.each([
    ['', 'The file is empty. Add the header row from template.csv, then one row for each grant.'],
    [`${header}\n`, 'The file has no grants. Add one row for each grant under the header row.'],
    [
      `${header}\n"NF-1,x\n`,
      'Row 2 has a quote mark that is not closed. Close the quoted value with a second quote mark.',
    ],
  ])('says what is wrong with a file that has no grants to read', (text, message) => {
    expect(problems(convert(text, publisher, modified))).toEqual([message]);
  });

  it(`refuses more than ${MAX_GRANTS} grants`, () => {
    const row = columns.map((column) => quote(grant[column])).join(',');
    const text = `${header}\n${`${row}\n`.repeat(MAX_GRANTS + 1)}`;
    expect(problems(convert(text, publisher, modified))).toEqual([
      'The file has more than 50,000 grants. Split it into files of 50,000 rows or fewer and convert each one.',
    ]);
  });
});
