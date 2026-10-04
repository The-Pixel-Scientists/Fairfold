// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party tables as this module queries them (migration 0005). Replace this
// with the generated types in packages/db/src/generated/party.ts when
// `pnpm db:types` writes them. Inserts take `tenant_id` from
// `app.current_tenant_id()`, the transaction's own tenant, never from a value.

import type { Transaction } from '@pixel-scientists/db';

import type { ConsentChannel, IdentifierScheme, LegalForm } from '../contracts/index.ts';

/** The caller's request transaction, which already has its tenant set. */
export type Tx = Transaction<unknown>;

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type PartyTables = {
  'party.party': {
    id: Generated<string>;
    tenant_id: string;
    kind: 'organisation' | 'person';
    created_by: string | null;
    updated_by: string | null;
  };
  'party.organisation': {
    id: string;
    tenant_id: string;
    name: string;
    legal_form: LegalForm;
    address_line1: string;
    address_line2: string | null;
    address_town: string;
    address_postcode: string;
    address_country_code: string;
    website: string | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'party.organisation_identifier': {
    id: Generated<string>;
    tenant_id: string;
    organisation_id: string;
    scheme: IdentifierScheme;
    identifier: string;
    verified_at: Date | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'party.person': {
    id: string;
    tenant_id: string;
    given_name: string | null;
    family_name: string | null;
    email: string;
    phone: string | null;
    user_id: string | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'party.relationship': {
    id: Generated<string>;
    tenant_id: string;
    type: 'contact_for';
    subject_id: string;
    subject_kind: 'person';
    object_id: string;
    object_kind: 'organisation';
    ends_on: Date | null;
    created_by: string | null;
    updated_by: string | null;
  };
  'party.consent': {
    id: Generated<string>;
    tenant_id: string;
    person_id: string;
    purpose: 'future_funding';
    channel: ConsentChannel;
    state: 'given' | 'withdrawn';
    privacy_notice_version: string;
    source: 'portal' | 'staff';
    recorded_at: Generated<Date>;
    recorded_by: string;
  };
};

/** The transaction typed to the party tables. */
export function partyDb(tx: Tx) {
  return tx.$extendTables<PartyTables>();
}

export type PartyDb = ReturnType<typeof partyDb>;
