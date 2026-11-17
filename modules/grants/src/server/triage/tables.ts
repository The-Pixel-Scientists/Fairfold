// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The triage tables (migration 0059) as this module queries them. Inserts
// take `tenant_id` from `app.current_tenant_id()`, the transaction's own
// tenant, never from a value. The database sets every time column.

import type { LabelColour } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type TriageTables = {
  'grants.application': { id: string; status: string };
  'grants.application_owner': {
    tenant_id: string;
    application_id: string;
    membership_id: string;
    assigned_by: string;
  };
  'grants.label': {
    id: Generated<string>;
    tenant_id: string;
    name: string;
    colour: LabelColour | null;
    archived: boolean;
  };
  'grants.application_label': {
    tenant_id: string;
    application_id: string;
    label_id: string;
    added_by: string;
  };
};

export const triageDb = (tx: Tx) => tx.$extendTables<TriageTables>();
