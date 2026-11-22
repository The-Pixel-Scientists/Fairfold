// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the import routes and the parse job read from the platform (ADR 0016,
// ADR 0017). crm never touches a party table or the object store: the
// platform passes in party's contract and the file service's clean-only
// read, in the caller's transaction, so row-level security keeps every
// answer in the caller's tenant.

import type {
  DuplicateCandidate,
  OrganisationInput,
  PartyKind,
} from '@pixel-scientists/party/contracts';

import type { Tx } from '../context.ts';
import type { PersonImportInput } from './rows.ts';

/** A record an import would make, valid against party's own schema for its kind. */
export type NewParty =
  | { readonly kind: 'organisation'; readonly input: OrganisationInput }
  | { readonly kind: 'person'; readonly input: PersonImportInput };

export interface ImportDependencies {
  readonly files: {
    /** The bytes of a clean file in this tenant; null for one that is missing, not clean or erased. */
    open(tx: Tx, fileId: string): Promise<AsyncIterable<Uint8Array> | null>;
  };
  readonly parties: {
    /**
     * Party's candidates for a record that does not exist yet, strongest first. Nothing is
     * stored, linked or flagged (ADR 0025).
     */
    duplicates(tx: Tx, party: NewParty): Promise<readonly DuplicateCandidate[]>;
    /**
     * Creates the record for `by`, as staff's own: identifiers unverified, no contact link,
     * consent, preference or account. It writes no audit event; the caller does.
     */
    create(tx: Tx, party: NewParty, by: { readonly membershipId: string }): Promise<string>;
  };
  /** Sends the parse job in the request's transaction, for the job's own id and nothing else. */
  readonly queueParse: (
    tx: Tx,
    importId: string,
    by: { readonly membershipId: string },
  ) => Promise<void>;
}

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type Tables = {
  'crm.import_job': {
    tenant_id: string;
    id: Generated<string>;
    file_id: string;
    target_kind: PartyKind;
    header_row: boolean;
    column_mapping: unknown;
    state: Generated<string>;
    row_count: Generated<number>;
    valid_count: Generated<number>;
    created_count: Generated<number>;
    error_code: string | null;
    requested_by: string;
    confirmed_by: string | null;
    completed_at: Date | null;
    created_at: Generated<Date>;
  };
  'crm.import_row': {
    tenant_id: string;
    id: Generated<string>;
    job_id: string;
    row_number: number;
    cells: unknown;
    errors: unknown;
    duplicate_party_id: string | null;
    created_party_id: string | null;
  };
  'app.tenant_module': { module: string; enabled: boolean };
};

/** The transaction typed to the tables an import uses. */
export const importDb = (tx: Tx) => tx.$extendTables<Tables>();

export type ImportDb = ReturnType<typeof importDb>;

/** Whether the tenant has crm switched on; a missing row is off. */
export async function crmEnabled(tx: Tx): Promise<boolean> {
  const row = await importDb(tx)
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', 'crm')
    .executeTakeFirst();
  return row?.enabled === true;
}
