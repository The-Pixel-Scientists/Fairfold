// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form version table as this module queries it (migration 0010). Replace
// this with the generated types once the db package exports them. Inserts
// take `tenant_id` from `app.current_tenant_id()`, the transaction's own
// tenant, never from a value. The `UPDATE` and `DELETE` policies match drafts
// only, so a statement that names a published version changes nothing.

import type { FormVersionStatus } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

/** A jsonb column, which pg reads as a value and takes as text. */
type Json = {
  readonly __select__: unknown;
  readonly __insert__: string | null;
  readonly __update__: string | null;
};

type FormTables = {
  'grants.round': { id: string; tenant_id: string };
  'grants.form_version': {
    id: Generated<string>;
    tenant_id: string;
    round_id: string;
    version: number;
    status: Generated<FormVersionStatus>;
    definition: Json;
    published_at: Date | null;
    published_by: string | null;
    updated_at: Generated<Date>;
    created_by: string | null;
    updated_by: string | null;
  };
  'app.membership': { id: string; tenant_id: string; user_id: string };
};

/** The transaction typed to the tables the form routes use. */
export function formsDb(tx: Tx) {
  return tx.$extendTables<FormTables>();
}

const UNIQUE_VIOLATION = '23505';

/** Whether a statement failed because another request added the same draft or version first. */
export function isDuplicate(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
