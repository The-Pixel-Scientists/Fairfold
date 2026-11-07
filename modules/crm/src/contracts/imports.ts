// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Importing organisations or people from a CSV file (ADR 0025, ADR 0030),
// under `crm.imports.run` with step-up, since it creates party records in
// bulk.
//
// 1. Start: an uploaded file's `app.file` id, the kind of record and which
//    column holds which field. A worker job reads and checks the file; the
//    route answers 202 with the job.
// 2. Preview: the job's state and its rows, each with errors as a field id
//    and a code, never a value in a problem, and party's duplicate signals
//    for a row like an existing record. Rows are checked with party's own
//    organisation and person schemas.
// 3. Confirm: creates a party record for each valid row, skipping or adding
//    rows like an existing record as staff choose. An import never verifies
//    an identifier, never links or merges anyone, and never sends.
//
// A cell a spreadsheet would run as a formula is refused here
// (isFormulaCell), so it is never stored; any later CSV export escapes
// every cell as well. Cell values never reach a problem, log or audit value.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { emailSchema } from '@pixel-scientists/domain/auth';
import {
  duplicateCandidateSchema,
  legalForms,
  organisationInputSchema,
  partyKinds,
  partyKindSchema,
  partyMessages,
  profileInputSchema,
  type PartyKind,
} from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { crmMessages, importRowMessages, says } from './messages.ts';
import {
  choice,
  cursorSchema,
  pageQuerySchema,
  personal,
  timestampSchema,
  unique,
} from './schemas.ts';

/** 5 MiB, well under the platform's file limit. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_COLUMNS = 50;

/** The fields a column can fill, by kind of record, required ones first. */
export const importFields = {
  organisation: [
    'name',
    'legal_form',
    'address_line1',
    'town',
    'postcode',
    'address_line2',
    'country_code',
    'website',
    'identifier_scheme',
    'identifier',
  ],
  person: ['given_name', 'family_name', 'email', 'phone'],
} as const satisfies Record<PartyKind, readonly string[]>;

export type ImportField = (typeof importFields)[PartyKind][number];

export const importFieldIds = [...importFields.organisation, ...importFields.person] as const;

/** The fields every row must fill. */
export const requiredImportFields = {
  organisation: ['name', 'legal_form', 'address_line1', 'town', 'postcode'],
  person: ['given_name', 'family_name', 'email'],
} as const satisfies { [K in PartyKind]: readonly (typeof importFields)[K][number][] };

export const importRowErrorCodes = Object.keys(importRowMessages) as [
  keyof typeof importRowMessages,
  ...(keyof typeof importRowMessages)[],
];

export type ImportRowErrorCode = (typeof importRowErrorCodes)[number];

export const importStartSchema = z
  .strictObject({
    fileId: idSchema,
    target: choice(partyKinds, crmMessages.partyKind),
    /** The first row names the columns and is not imported. */
    headerRow: z.boolean(),
    mapping: z
      .array(
        z.strictObject({
          /** From 1, as a spreadsheet numbers columns. */
          column: z
            .int()
            .refine(
              (column) => column >= 1 && column <= IMPORT_MAX_COLUMNS,
              says(crmMessages.importColumn),
            ),
          field: choice(importFieldIds, crmMessages.importField),
        }),
      )
      .min(1)
      .max(IMPORT_MAX_COLUMNS)
      .refine(...unique((item: { field: string }) => item.field))
      .refine(...unique((item: { column: number }) => String(item.column))),
  })
  .refine(
    ({ target, mapping }) =>
      mapping.every(({ field }) => (importFields[target] as readonly string[]).includes(field)),
    { ...says(crmMessages.importField), path: ['mapping'] },
  )
  .refine(
    ({ target, mapping }) =>
      requiredImportFields[target].every((field) => mapping.some((item) => item.field === field)),
    { ...says(crmMessages.importRequired), path: ['mapping'] },
  );

export type ImportStart = z.input<typeof importStartSchema>;

export const importStates = [
  'queued',
  'checking',
  'ready',
  'failed',
  'importing',
  'completed',
] as const;

/** Why a file could not be read; each failure is the whole file's. */
export const importFailures = [
  'file_unreadable',
  'not_csv',
  'too_large',
  'too_many_rows',
  'too_many_columns',
  'no_rows',
] as const;

export const importJobSchema = z.strictObject({
  id: idSchema,
  target: partyKindSchema,
  state: z.enum(importStates),
  failure: z.enum(importFailures).nullable(),
  rows: z.strictObject({
    total: z.int().nonnegative(),
    valid: z.int().nonnegative(),
    withErrors: z.int().nonnegative(),
    duplicates: z.int().nonnegative(),
  }),
  /** Set once confirmed. */
  result: z
    .strictObject({ created: z.int().nonnegative(), skipped: z.int().nonnegative() })
    .nullable(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});

export type ImportJob = z.infer<typeof importJobSchema>;

export const importRowErrorSchema = z.strictObject({
  field: z.enum(importFieldIds),
  code: z.enum(importRowErrorCodes),
});

export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const rowStatuses = ['valid', 'error', 'duplicate'] as const;

export const importRowSchema = z.strictObject({
  /** The row's number in the file, from 1, counting a header row. */
  row: z.int().min(1),
  status: z.enum(rowStatuses),
  values: personal(z.partialRecord(z.enum(importFieldIds), z.string())),
  errors: z.array(importRowErrorSchema),
  duplicates: z.array(duplicateCandidateSchema),
});

/** In file order. `nextCursor` is null on the last page. */
export const importRowPageSchema = z.strictObject({
  rows: z.array(importRowSchema),
  nextCursor: cursorSchema.nullable(),
});

export const duplicateRowChoices = ['skip', 'create'] as const;

/** Rows with errors are always skipped. */
export const importConfirmSchema = z.strictObject({
  duplicates: choice(duplicateRowChoices, crmMessages.duplicateChoice),
});

export const importResultSchema = z.strictObject({
  created: z.int().nonnegative(),
  skippedErrors: z.int().nonnegative(),
  skippedDuplicates: z.int().nonnegative(),
});

/**
 * Whether a spreadsheet would run a cell as a formula: one starting with
 * `=`, `@`, a tab or a carriage return, or with `+` or `-` and anything
 * but digits, spaces, brackets and hyphens, so `+44 7700 900982` is kept.
 */
export function isFormulaCell(value: string): boolean {
  if (/^[\t\r]/.test(value)) return true;
  const text = value.trimStart();
  return /^[=@]/.test(text) || (/^[+-]/.test(text) && !/^[+-][0-9][0-9 ()-]*$/.test(text));
}

type RowValues = Partial<Record<ImportField, string>>;

/** A legal form as its code or its words, in any case. */
function legalForm(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const wanted = value.trim().toLowerCase();
  const match = Object.entries(legalForms).find(
    ([code, label]) => code === wanted || label.toLowerCase() === wanted,
  );
  return match?.[0] ?? value;
}

const blank = (value: string | undefined) =>
  value === undefined || value.trim() === '' ? undefined : value;

function organisationInput(values: RowValues) {
  const scheme = blank(values.identifier_scheme);
  const identifier = blank(values.identifier);
  return {
    name: values.name ?? '',
    legalForm: legalForm(values.legal_form),
    identifiers:
      scheme === undefined && identifier === undefined
        ? []
        : [{ scheme: scheme?.trim().toUpperCase(), identifier: identifier ?? '' }],
    registeredAddress: {
      line1: values.address_line1 ?? '',
      line2: blank(values.address_line2),
      town: values.town ?? '',
      postcode: values.postcode ?? '',
      countryCode: blank(values.country_code),
    },
    website: blank(values.website),
  };
}

const personInputSchema = profileInputSchema.extend({ email: emailSchema });

function personInput(values: RowValues) {
  return {
    givenName: values.given_name ?? '',
    familyName: values.family_name ?? '',
    email: values.email ?? '',
    phone: blank(values.phone),
  };
}

/** Where each import field sits in party's input schemas. */
const partyPaths = new Map<string, ImportField>([
  ['name', 'name'],
  ['legalForm', 'legal_form'],
  ['website', 'website'],
  ['registeredAddress.line1', 'address_line1'],
  ['registeredAddress.line2', 'address_line2'],
  ['registeredAddress.town', 'town'],
  ['registeredAddress.postcode', 'postcode'],
  ['registeredAddress.countryCode', 'country_code'],
  ['identifiers.0.identifier', 'identifier'],
  ['givenName', 'given_name'],
  ['familyName', 'family_name'],
  ['email', 'email'],
  ['phone', 'phone'],
]);

/** The import field an issue is about; any other identifier issue is about its scheme. */
function fieldAt(path: readonly PropertyKey[]): ImportField {
  const key = path.map(String).join('.');
  return partyPaths.get(key) ?? (key.startsWith('identifiers') ? 'identifier_scheme' : 'name');
}

function codeFor(issue: z.core.$ZodIssue): ImportRowErrorCode {
  if (issue.code === 'too_big') return 'too_long';
  if (issue.code === 'invalid_value' || issue.code === 'invalid_union') return 'not_in_list';
  if (issue.code === 'custom' && issue.message === partyMessages.hiddenCharacters) {
    return 'hidden_characters';
  }
  return 'not_valid';
}

/**
 * Everything wrong with one row, at most one error a field: a formula, a
 * missing required field, then what party's schema refuses. Never a value.
 */
export function importRowErrors(target: PartyKind, values: RowValues): ImportRowError[] {
  const errors = new Map<ImportField, ImportRowErrorCode>();
  for (const field of importFields[target]) {
    const value = values[field];
    if (value !== undefined && isFormulaCell(value)) errors.set(field, 'formula');
    else if (
      (requiredImportFields[target] as readonly string[]).includes(field) &&
      blank(value) === undefined
    ) {
      errors.set(field, 'required');
    }
  }
  const result =
    target === 'organisation'
      ? organisationInputSchema.safeParse(organisationInput(values))
      : personInputSchema.safeParse(personInput(values));
  for (const issue of result.error?.issues ?? []) {
    const field = fieldAt(issue.path);
    if (!errors.has(field)) errors.set(field, codeFor(issue));
  }
  return [...errors].map(([field, code]) => ({ field, code }));
}

const run = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.imports.run',
  scope: 'tenant',
} as const;

const job = { params: z.strictObject({ importId: idSchema }) } as const;

export const startImport = defineRoute({
  ...run,
  stepUp: true,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/imports',
  summary: 'Start importing organisations or people from an uploaded CSV file',
  body: importStartSchema,
  responses: { 202: importJobSchema },
});

export const getImport = defineRoute({
  ...run,
  ...job,
  method: 'GET',
  path: '/console/crm/imports/:importId',
  summary: "Read an import's state and row counts",
  responses: { 200: importJobSchema },
});

export const listImportRows = defineRoute({
  ...run,
  ...job,
  method: 'GET',
  path: '/console/crm/imports/:importId/rows',
  summary: "Read an import's rows with their errors and possible duplicates",
  query: pageQuerySchema,
  responses: { 200: importRowPageSchema },
});

export const confirmImport = defineRoute({
  ...run,
  ...job,
  stepUp: true,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/imports/:importId/confirmation',
  summary: 'Create a record for each valid row of a checked import',
  body: importConfirmSchema,
  responses: { 200: importResultSchema },
});

export const importRoutes = { startImport, getImport, listImportRows, confirmImport } as const;
