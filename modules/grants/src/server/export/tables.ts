// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the export routes use, with the columns they touch (migrations
// 0009, 0011 and 0013). Inserts take `tenant_id` from
// `app.current_tenant_id()`, the transaction's own tenant, never from a value.

import type { Tx } from '../programme/tables.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type ExportTables = {
  'grants.programme': { id: string; title: string; summary: string; updated_at: Date };
  'grants.round': { id: string; programme_id: string; title: string; updated_at: Date };
  'grants.application': { id: string; round_id: string; organisation_id: string };
  'grants.decision': {
    id: string;
    application_id: string;
    outcome: 'accepted' | 'waitlisted' | 'declined';
    amount_minor: string | null;
    currency: 'GBP' | null;
    released_at: Date | null;
    updated_at: Date;
  };
  'grants.publisher_setting': {
    id: Generated<string>;
    tenant_id: string;
    funder_identifier: string;
    funder_name: string;
    identifier_prefix: string;
    updated_at: Generated<Date>;
    created_by: string;
    updated_by: string;
  };
};

/** The transaction typed to the tables the export routes use. */
export function exportDb(tx: Tx) {
  return tx.$extendTables<ExportTables>();
}

export type ExportDb = ReturnType<typeof exportDb>;
