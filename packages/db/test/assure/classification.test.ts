// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The register columns' classes in classification/assure.ts against the
// assure contracts' registryResultClassification (S11-37), so the two
// cannot drift. packages/db cannot import a module, so this reads the
// contract's source and maps each result field to the columns that hold it.

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { assure } from '../../classification/assure.ts';

const CONTRACT = new URL('../../../../modules/assure/src/contracts/registry.ts', import.meta.url);

/** Each result field's columns, as table.column. */
const COLUMNS: Readonly<Record<string, readonly string[]>> = {
  registry: ['lookup_snapshot.registry'],
  identifier: ['lookup_snapshot.identifier', 'lookup_snapshot.scheme'],
  fetchedAt: ['lookup_snapshot.fetched_at'],
  status: ['lookup_snapshot.registry_status'],
  registeredName: ['lookup_snapshot.registered_name'],
  registeredAddress: [
    'lookup_snapshot.address_line1',
    'lookup_snapshot.address_line2',
    'lookup_snapshot.address_town',
    'lookup_snapshot.address_postcode',
    'lookup_snapshot.address_country_code',
  ],
  registeredOn: ['lookup_snapshot.registered_on'],
  removedOn: ['lookup_snapshot.removed_on'],
  accounts: [
    'lookup_snapshot.accounts_period_end',
    'lookup_snapshot.income_minor',
    'lookup_snapshot.income_currency',
    'lookup_snapshot.expenditure_minor',
    'lookup_snapshot.expenditure_currency',
  ],
  accountsOverdue: ['lookup_snapshot.accounts_overdue'],
  // An officer is a name and a role; the name carries the class.
  officers: ['lookup_officer.name'],
};

async function contractClasses(): Promise<Record<string, string>> {
  const source = await readFile(CONTRACT, 'utf8');
  const block = /export const registryResultClassification = \{([^}]*)\}/.exec(source)?.[1];
  if (!block) throw new Error('registryResultClassification is not in the contract.');
  const classes: Record<string, string> = {};
  for (const [, field = '', sensitivity = ''] of block.matchAll(/^\s*(\w+): '(\w+)',$/gm)) {
    classes[field] = sensitivity;
  }
  return classes;
}

const classOf = (column: string): string | undefined => {
  const [table = '', name = ''] = column.split('.');
  const fields: Readonly<Record<string, { sensitivity: string } | undefined>> | undefined =
    Object.hasOwn(assure, `assure.${table}`)
      ? assure[`assure.${table}` as keyof typeof assure]
      : undefined;
  return fields?.[name]?.sensitivity;
};

describe('the register columns', () => {
  it('map every field of the contract, and no other', async () => {
    expect(Object.keys(await contractClasses()).sort()).toEqual(Object.keys(COLUMNS).sort());
  });

  it("take each field's class from the contract", async () => {
    for (const [field, sensitivity] of Object.entries(await contractClasses())) {
      for (const column of COLUMNS[field] ?? []) {
        expect(classOf(column), `${field}: ${column}`).toBe(sensitivity);
      }
    }
  });

  it("classify officers' names as personal and their roles as internal", () => {
    expect(classOf('lookup_officer.name')).toBe('personal');
    expect(classOf('lookup_officer.role')).toBe('internal');
  });
});
