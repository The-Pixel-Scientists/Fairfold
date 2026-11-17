// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The saved view table (migration 0059) as this module queries it. A view
// holds the list's filter, sort and column keys, never a resolved id list.

import type { Tx } from '../programme/tables.ts';

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

/** A jsonb column, which pg reads as a value and takes as text. */
type Json = {
  readonly __select__: unknown;
  readonly __insert__: string;
  readonly __update__: string;
};

export interface ViewRow {
  readonly id: string;
  readonly name: string;
  readonly filter: unknown;
  readonly sort: unknown;
  readonly columns: string[];
  readonly created_by: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

type ViewTables = {
  'grants.saved_view': {
    id: Generated<string>;
    tenant_id: string;
    name: string;
    filter: Json;
    sort: Json;
    columns: { __select__: string[]; __insert__: string[]; __update__: string[] };
    created_by: string;
    updated_by: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  'grants.form_version': { id: string; round_id: string; status: string; definition: unknown };
  'grants.round': { id: string; programme_id: string };
};

export const viewDb = (tx: Tx) => tx.$extendTables<ViewTables>();
