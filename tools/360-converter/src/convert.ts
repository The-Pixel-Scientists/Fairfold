// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A CSV of grants to organisations, as template.csv lays it out, to a
// 360Giving file. Each grant is built with the grants export's own rules and
// checked against its schema (D15), so the two write the same JSON. Unlike
// the export, the converter cannot verify an identifier, so the summary
// counts every recipient as unchecked (D24). Pure: no Node.js module, so a
// web page can run it too.

import '@pixel-scientists/domain/jitless';

import { moneySchema, type Currency } from '@pixel-scientists/domain/platform';
import {
  amountAwarded,
  grantIdentifier,
  publisherSettingInputSchema,
  recipientOrganization,
  threeSixtyGivingGrantSchema,
  type PublisherSettingInput,
  type ThreeSixtyGivingGrant,
} from '@pixel-scientists/grants/contracts';
import { identifierInputSchema, identifierSchemeSchema } from '@pixel-scientists/party/contracts';

import { readCsv } from './csv.ts';
import { columnMessages, converterMessages as says, type Column } from './messages.ts';

/** The most grants one file may hold. */
export const MAX_GRANTS = 50_000;

export const columns = Object.keys(columnMessages) as readonly Column[];

/** The funder's details, as the export's publisher settings hold them. */
export type Publisher = PublisherSettingInput;

export const publisherLabels: Readonly<Record<keyof Publisher, string>> = {
  funderName: 'Funder name',
  funderIdentifier: 'Funder identifier',
  identifierPrefix: 'Identifier prefix',
};

export type Conversion =
  | {
      readonly ok: true;
      readonly file: { readonly grants: readonly ThreeSixtyGivingGrant[] };
      readonly summary: { readonly grants: number; readonly uncheckedRecipients: number };
    }
  | { readonly ok: false; readonly problems: readonly string[] };

const INDIVIDUAL = /individual|recipient ind\b/i;
const HIDDEN = /[\p{Cc}\p{Cf}]/gu;

/** Digits after the decimal point, as moneySchema's currencies use them. */
const minorDigits = { GBP: 2 } as const satisfies Record<Currency, number>;

const fields: Readonly<Record<string, Column>> = {
  id: 'Grant reference',
  title: 'Title',
  description: 'Description',
  currency: 'Currency',
  amountAwarded: 'Amount',
  awardDate: 'Award date',
  grantProgramme: 'Programme title',
};

/**
 * Converts `csv`, publishing each grant as modified at `dateModified`. Any
 * problem fails the whole file, with every problem listed.
 */
export function convert(csv: string, publisher: Publisher, dateModified: string): Conversion {
  threeSixtyGivingGrantSchema.shape.dateModified.parse(dateModified);
  const funder = publisherSettingInputSchema.safeParse(publisher);
  const problems = (funder.error?.issues ?? []).map((issue) =>
    says.option(publisherLabels[issue.path[0] as keyof Publisher], issue.message),
  );
  const failed = (...more: string[]): Conversion => ({
    ok: false,
    problems: [...problems, ...more],
  });

  const read = readCsv(csv, MAX_GRANTS + 1);
  if (read.kind === 'tooManyRows') return failed(says.tooManyRows(MAX_GRANTS));
  if (read.kind === 'unclosedQuote') return failed(says.unclosedQuote(read.row));
  const [header, ...rows] = read.rows;
  if (header === undefined) return failed(says.emptyFile);
  const positions = readHeader(header.cells);
  if (Array.isArray(positions)) return failed(...positions);
  if (rows.length === 0) return failed(says.noGrants);

  const { funderIdentifier, funderName, identifierPrefix } = funder.data ?? publisher;
  const references = new Map<string, number>();
  const recipients = new Set<string>();
  const grants: ThreeSixtyGivingGrant[] = [];
  for (const { row, cells } of rows) {
    const values = cellsByColumn(positions, cells);
    if (values === undefined) {
      problems.push(says.extraValues(row));
      continue;
    }
    const reference = values['Grant reference'];
    const first = references.get(reference);
    if (first !== undefined && reference !== '') problems.push(says.repeatedReference(row, first));
    else references.set(reference, row);

    const built = buildGrant(
      row,
      values,
      identifierPrefix,
      { id: funderIdentifier, name: funderName },
      dateModified,
    );
    if (Array.isArray(built)) {
      problems.push(...built);
    } else {
      grants.push(built);
      for (const recipient of built.recipientOrganization) recipients.add(recipient.id);
    }
  }
  if (problems.length > 0) return failed();
  return {
    ok: true,
    file: { grants },
    summary: { grants: grants.length, uncheckedRecipients: recipients.size },
  };
}

/** Each template column's position, or what is wrong with the header row. */
function readHeader(names: readonly string[]): ReadonlyMap<Column, number> | string[] {
  const problems: string[] = [];
  const positions = new Map<Column, number>();
  names.forEach((name, index) => {
    if (name === '') return;
    const column = columns.find((known) => known.toLowerCase() === name.toLowerCase());
    if (column === undefined) {
      problems.push(
        INDIVIDUAL.test(name)
          ? says.individualColumn(index + 1)
          : says.unknownColumn(index + 1, name.replace(HIDDEN, '').slice(0, 60)),
      );
    } else if (positions.has(column)) {
      problems.push(says.repeatedColumn(column));
    } else {
      positions.set(column, index);
    }
  });
  for (const column of columns) {
    if (!positions.has(column)) problems.push(says.missingColumn(column));
  }
  return problems.length > 0 ? problems : positions;
}

/** The row's value in each column, or undefined if it has a value under no column. */
function cellsByColumn(
  positions: ReadonlyMap<Column, number>,
  cells: readonly string[],
): Record<Column, string> | undefined {
  const used = new Set(positions.values());
  if (cells.some((cell, index) => cell !== '' && !used.has(index))) return undefined;
  return Object.fromEntries(
    columns.map((column) => [column, cells[positions.get(column) ?? -1] ?? '']),
  ) as Record<Column, string>;
}

/** Pence from "2500.50", by string, never by floating-point arithmetic. */
function amountMinor(text: string, currency: Currency): number | undefined {
  const digits = minorDigits[currency];
  const match = new RegExp(`^([0-9]{1,13})(?:\\.([0-9]{1,${digits}}))?$`).exec(text);
  if (match === null) return undefined;
  const [, whole = '', fraction = ''] = match;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
}

function buildGrant(
  row: number,
  values: Record<Column, string>,
  prefix: string,
  funder: { id: string; name: string },
  dateModified: string,
): ThreeSixtyGivingGrant | string[] {
  const name = values['Recipient organisation name'];
  const scheme = identifierSchemeSchema.safeParse(values['Recipient scheme'].toUpperCase());
  if (name === '' || values['Recipient scheme'] === '') return [says.noOrganisation(row)];

  const problems = new Map<Column, string>();
  const say = (column: Column, message: string = columnMessages[column]) => {
    if (!problems.has(column)) problems.set(column, message);
  };

  const identifier = scheme.success
    ? identifierInputSchema.safeParse({
        scheme: scheme.data,
        identifier: values['Recipient identifier'],
      })
    : undefined;
  if (identifier === undefined) say('Recipient scheme');
  else if (!identifier.success) {
    say('Recipient identifier', identifier.error.issues[0]?.message);
  }

  const currency = moneySchema.shape.currency.safeParse(values.Currency);
  let awarded: number | undefined;
  if (!currency.success) {
    say('Currency');
  } else {
    const money = moneySchema.safeParse({
      amountMinor: amountMinor(values.Amount, currency.data),
      currency: currency.data,
    });
    if (money.success) awarded = amountAwarded(money.data);
    else say('Amount');
  }

  const { recipient } = recipientOrganization(prefix, {
    id: values['Grant reference'],
    name,
    identifiers: identifier?.success ? [{ ...identifier.data, verified: false }] : [],
  });
  const grant = threeSixtyGivingGrantSchema.safeParse({
    id: grantIdentifier(prefix, values['Grant reference']),
    title: values.Title,
    description: values.Description,
    currency: values.Currency,
    amountAwarded: awarded,
    awardDate: values['Award date'],
    recipientOrganization: [recipient],
    fundingOrganization: [funder],
    grantProgramme: [{ title: values['Programme title'] }],
    dateModified,
  });
  for (const issue of grant.error?.issues ?? []) {
    const column = columnAt(issue.path);
    // With no currency, the amount is not read: the currency's message says what to fix.
    if (column !== undefined && (column !== 'Amount' || awarded !== undefined)) say(column);
  }
  if (problems.size > 0 || !grant.success) {
    return columns.flatMap((column) => {
      const message = problems.get(column);
      return message === undefined ? [] : [says.cell(row, column, message)];
    });
  }
  return grant.data;
}

/** The column a schema issue is about; none for the funder, which the options set. */
function columnAt(path: readonly PropertyKey[]): Column | undefined {
  const [field, , key] = path;
  if (field === 'recipientOrganization') {
    return key === 'name' ? 'Recipient organisation name' : 'Recipient identifier';
  }
  return typeof field === 'string' ? fields[field] : undefined;
}
