// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the party schema tests (migration 0005): organisations and
// people with their parties, added through a client with the tenant set.

import type pg from 'pg';

import { insertRow, testSlug, type Row, type TestTenant } from '../tenants.ts';

export const PARTY_TABLES = [
  'party.party',
  'party.organisation',
  'party.organisation_identifier',
  'party.person',
  'party.relationship',
  'party.consent',
] as const;

/** Columns for a valid organisation row on party `id`. */
export function organisationRow(tenant: TestTenant, id: string, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    id,
    name: 'Northfield Allotment Society',
    legal_form: 'community_benefit_society',
    address_line1: '1 High Street',
    address_town: 'Northfield',
    address_postcode: 'NF1 2AB',
    ...change,
  };
}

/** Columns for a valid person row on party `id`. */
export function personRow(tenant: TestTenant, id: string, change: Row = {}): Row {
  return { tenant_id: tenant.id, id, email: `${testSlug()}@example.test`, ...change };
}

/** Add a party of `kind` and return its id. */
export function addParty(
  client: pg.ClientBase,
  tenant: TestTenant,
  kind: 'organisation' | 'person',
): Promise<string> {
  return insertRow(client, 'party.party', { tenant_id: tenant.id, kind });
}

/** Add an organisation with its party and return its id. */
export async function addOrganisation(
  client: pg.ClientBase,
  tenant: TestTenant,
  change: Row = {},
): Promise<string> {
  const id = await addParty(client, tenant, 'organisation');
  return insertRow(client, 'party.organisation', organisationRow(tenant, id, change));
}

/** Add a person with their party and return their id. */
export async function addPerson(
  client: pg.ClientBase,
  tenant: TestTenant,
  change: Row = {},
): Promise<string> {
  const id = await addParty(client, tenant, 'person');
  return insertRow(client, 'party.person', personRow(tenant, id, change));
}
