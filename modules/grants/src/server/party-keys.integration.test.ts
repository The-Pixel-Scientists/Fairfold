// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every column in grants that holds a party key is declared (ADR 0025): the
// foreign keys to the party tables in the catalogue match the contract's list
// of columns a merge re-points plus the one it never moves, so a party key
// added to grants cannot be missed silently by a merge.

import { describe, expect, it } from 'vitest';

import { withClient } from '../../../../packages/db/test/connect.ts';
import { grantsPartyKeys, grantsPartyKeysExcluded } from '../contracts/index.ts';

const PARTY_TABLES = [
  'party.party',
  'party.person',
  'party.organisation',
  'party.organisation_snapshot',
];

/** `grants.<table>.<column>` for each column of a grants foreign key to a party table, tenant column left out. */
const partyKeyColumns = () =>
  withClient('migrator', async (client) => {
    const { rows } = await client.query<{ key: string }>(
      `SELECT DISTINCT format('%s.%s.%s', n.nspname, c.relname, a.attname) AS key
         FROM pg_catalog.pg_constraint k
         JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_class p ON p.oid = k.confrelid
         JOIN pg_catalog.pg_namespace pn ON pn.oid = p.relnamespace
         CROSS JOIN LATERAL unnest(k.conkey) AS col(attnum)
         JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = col.attnum
        WHERE k.contype = 'f' AND n.nspname = 'grants'
          AND format('%s.%s', pn.nspname, p.relname) = ANY($1)
          AND a.attname <> 'tenant_id'
        ORDER BY 1`,
      [PARTY_TABLES],
    );
    return rows.map(({ key }) => key);
  });

describe('grants party keys', { timeout: 30_000 }, () => {
  it('are exactly the declared columns, re-pointed or excluded', async () => {
    const declared = [...grantsPartyKeys, ...grantsPartyKeysExcluded]
      .map(({ table, column }) => `${table}.${column}`)
      .sort();
    expect(await partyKeyColumns()).toEqual(declared);
  });
});
