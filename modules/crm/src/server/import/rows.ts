// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One import row (ADR 0025): the cells a column mapping picked out, what is
// wrong with them, and the party record they would make. Rows are checked
// by the contract's importRowErrors(), which uses party's own schemas; the
// record is built here, from the same schemas, so a row the contract passes
// always parses. A cell that holds a formula or hidden characters is
// refused and never stored.

import { emailSchema } from '@pixel-scientists/domain/auth';
import {
  legalForms,
  organisationInputSchema,
  profileInputSchema,
  type PartyKind,
} from '@pixel-scientists/party/contracts';

import {
  importFields,
  importRowErrors,
  type ImportField,
  type ImportRowError,
} from '../../contracts/index.ts';
import type { NewParty } from './context.ts';

export type Cells = Partial<Record<ImportField, string>>;

/** Longest cell kept: party's longest field is 200 characters, so a longer one is already too long. */
const CELL_MAX = 500;

export const personInputSchema = profileInputSchema.extend({ email: emailSchema });

export type PersonImportInput = (typeof personInputSchema)['_output'];

const blank = (value: string | undefined) =>
  value === undefined || value.trim() === '' ? undefined : value;

/** A legal form as its code or its words, in any case. */
function legalForm(value: string | undefined): string | undefined {
  const wanted = value?.trim().toLowerCase();
  const match = Object.entries(legalForms).find(
    ([code, label]) => code === wanted || label.toLowerCase() === wanted,
  );
  return match?.[0] ?? value;
}

/** The party record a row with no errors makes. */
export function partyInput(target: PartyKind, cells: Cells): NewParty {
  if (target === 'person') {
    return {
      kind: 'person',
      input: personInputSchema.parse({
        givenName: cells.given_name ?? '',
        familyName: cells.family_name ?? '',
        email: cells.email ?? '',
        phone: blank(cells.phone),
      }),
    };
  }
  const scheme = blank(cells.identifier_scheme);
  const identifier = blank(cells.identifier);
  return {
    kind: 'organisation',
    input: organisationInputSchema.parse({
      name: cells.name ?? '',
      legalForm: legalForm(cells.legal_form),
      identifiers:
        scheme === undefined && identifier === undefined
          ? []
          : [{ scheme: scheme?.trim().toUpperCase(), identifier: identifier ?? '' }],
      registeredAddress: {
        line1: cells.address_line1 ?? '',
        line2: blank(cells.address_line2),
        town: cells.town ?? '',
        postcode: cells.postcode ?? '',
        countryCode: blank(cells.country_code),
      },
      website: blank(cells.website),
    }),
  };
}

/** What identifies a row within its file, to refuse the same record twice. */
function sameRecord(target: PartyKind, cells: Cells): string {
  const text = (value: string | undefined) => (value ?? '').trim().toLowerCase();
  return target === 'person'
    ? text(cells.email)
    : `${text(cells.name)}|${text(cells.postcode).replace(/\s+/g, '')}`;
}

const NOT_STORED: readonly string[] = ['formula', 'hidden_characters'];

export interface CheckedRow {
  readonly cells: Cells;
  readonly errors: ImportRowError[];
}

/**
 * A record of the file against the mapping (column number to field).
 * `seen` holds the earlier rows' identities, to refuse a repeat.
 */
export function checkRow(
  target: PartyKind,
  mapping: Readonly<Record<string, ImportField>>,
  record: readonly string[],
  seen: Set<string>,
): CheckedRow {
  const raw: Cells = {};
  for (const [column, field] of Object.entries(mapping)) {
    const value = record[Number(column) - 1];
    if (value !== undefined) raw[field] = value;
  }
  const codes = new Map(importRowErrors(target, raw).map(({ field, code }) => [field, code]));
  for (const [field, value] of Object.entries(raw)) {
    if (value.includes('\0')) codes.set(field as ImportField, 'hidden_characters');
  }
  if (codes.size === 0) {
    const key = sameRecord(target, raw);
    if (seen.has(key)) codes.set(target === 'person' ? 'email' : 'name', 'repeated_in_file');
    seen.add(key);
  }
  const cells: Cells = {};
  for (const field of importFields[target]) {
    const value = raw[field];
    if (value !== undefined && !NOT_STORED.includes(codes.get(field) ?? '')) {
      cells[field] = value.slice(0, CELL_MAX);
    }
  }
  return { cells, errors: [...codes].map(([field, code]) => ({ field, code })) };
}
