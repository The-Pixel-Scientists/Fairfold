// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's contribution to the shared warehouse (ADR 0016), read
// in the caller's transaction. Nothing about a decision shows before its
// release: a commitment is an accepted decision that is released. The
// platform's classification filter drops any column whose source is not
// public or internal.

import type { WarehouseContribution } from '@pixel-scientists/domain/warehouse';

import type { Tx } from './programme/tables.ts';
import { grantsModuleTables } from './warehouse-tables.ts';
import { iso, required } from './warehouse-values.ts';

/** The columns these readers use (migrations 0009, 0011 and 0013). */
type Sources = {
  'grants.programme': {
    id: string;
    title: string;
    summary: string;
    status: string;
    created_at: Date;
  };
  'grants.round': { id: string; programme_id: string };
  'grants.application': { id: string; round_id: string; organisation_id: string };
  'grants.decision': {
    id: string;
    application_id: string;
    outcome: string;
    amount_minor: string | null;
    currency: string | null;
    released_at: Date | null;
  };
};

export const grantsWarehouse: WarehouseContribution<'grants', Tx> = {
  module: 'grants',
  tables: {
    ...grantsModuleTables,

    async programme(tx) {
      const rows = await tx
        .$extendTables<Sources>()
        .selectFrom('grants.programme')
        .select(['id', 'title', 'summary', 'status', 'created_at'])
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      return rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    },

    async commitment(tx, tenant) {
      const rows = await tx
        .$extendTables<Sources>()
        .selectFrom('grants.decision as d')
        .innerJoin('grants.application as a', 'a.id', 'd.application_id')
        .innerJoin('grants.round as r', 'r.id', 'a.round_id')
        .select([
          'd.id',
          'r.programme_id',
          'a.organisation_id',
          'd.amount_minor',
          'd.currency',
          (eb) =>
            eb
              .fn<string>('to_char', [
                eb.fn('timezone', [eb.val(tenant.timezone), eb.ref('d.released_at')]),
                eb.val('YYYY-MM-DD'),
              ])
              .as('committed_on'),
        ])
        .where('d.outcome', '=', 'accepted')
        .where('d.released_at', 'is not', null)
        .orderBy('d.released_at')
        .orderBy('d.id')
        .execute();
      return rows.map((row) => ({
        id: row.id,
        programme_id: row.programme_id,
        organisation_id: row.organisation_id,
        amount_minor: Number(required(row.amount_minor)),
        currency: required(row.currency),
        committed_on: row.committed_on,
      }));
    },
  },
};
