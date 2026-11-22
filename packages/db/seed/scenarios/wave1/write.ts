// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each part of the wave1 scenario writes with. writeTenant() sets a
// tenant transaction-locally and writes its members (scenario.ts); a part
// then writes that tenant's rows of one tool through the same client, after
// index.ts has checked that the tenant set is still the one written. Every
// row goes in through forced row-level security, as migrator.

import type { Role, SwitchableModuleId } from '@pixel-scientists/domain/platform';
import type pg from 'pg';

import type { SeededTenant, Tenant } from '../../scenario.ts';

/** A wave 1 tenant, with the tools its data is for. */
export interface Wave1Tenant extends Tenant {
  readonly tools: readonly SwitchableModuleId[];
}

/** Writes one tool's rows for a tenant whose list has that tool. */
export interface Part {
  readonly tool: SwitchableModuleId;
  readonly write: (writer: PartWriter) => Promise<void>;
}

export interface PartWriter {
  readonly client: pg.ClientBase;
  readonly tenant: Wave1Tenant;
  readonly tenantId: string;
  /** The ids writeTenant() wrote, by table, in the order it wrote them. */
  readonly written: SeededTenant['rows'];
  /** Insert one row into the tenant set, keeping its id under its table. */
  readonly insert: (table: string, values: Readonly<Record<string, unknown>>) => Promise<string>;
  /** The first staff membership with `role`. */
  readonly member: (role: Role) => string;
}

export interface Organisation {
  readonly name: string;
  readonly legalForm: string;
  readonly addressLine1: string;
  readonly town: string;
  readonly postcode: string;
}

/** Refuse to write unless `tenantId` is the tenant set in this transaction. */
export async function requireTenant(client: pg.ClientBase, tenantId: string): Promise<void> {
  const { rows } = await client.query<{ set: boolean }>(
    'SELECT app.current_tenant_id() IS NOT DISTINCT FROM $1::uuid AS set',
    [tenantId],
  );
  if (rows[0]?.set !== true) throw new Error('The wave 1 tenant is not the tenant set.');
}

export function partWriter(
  client: pg.ClientBase,
  tenant: Wave1Tenant,
  seeded: SeededTenant,
  rows: Record<string, string[]>,
): PartWriter {
  const quote = (name: string) =>
    name
      .split('.')
      .map((part) => client.escapeIdentifier(part))
      .join('.');
  return {
    client,
    tenant,
    tenantId: seeded.id,
    written: seeded.rows,
    insert: async (table, values) => {
      const columns = Object.keys(values).map((column) => client.escapeIdentifier(column));
      const parameters = columns.map((_, index) => `$${String(index + 1)}`);
      const { rows: added } = await client.query<{ id: string }>(
        `INSERT INTO ${quote(table)} (${columns.join(', ')}) VALUES (${parameters.join(', ')}) RETURNING id`,
        Object.values(values),
      );
      const id = added[0]?.id;
      if (id === undefined) throw new Error(`The insert into ${table} returned no row.`);
      (rows[table] ??= []).push(id);
      return id;
    },
    member: (role) => {
      const index = tenant.staff.findIndex((member) => member[2] === role);
      const id = seeded.rows['app.membership']?.[index];
      if (index < 0 || id === undefined) throw new Error(`${tenant.name} has no ${role}.`);
      return id;
    },
  };
}

/** A party organisation in the tenant set: its party id. */
export async function addOrganisation(
  writer: PartWriter,
  organisation: Organisation,
): Promise<string> {
  const { insert, tenantId } = writer;
  const id = await insert('party.party', { tenant_id: tenantId, kind: 'organisation' });
  await insert('party.organisation', {
    tenant_id: tenantId,
    id,
    name: organisation.name,
    legal_form: organisation.legalForm,
    address_line1: organisation.addressLine1,
    address_town: organisation.town,
    address_postcode: organisation.postcode,
  });
  return id;
}

/** A person with no account in the tenant set: their party id. */
export async function addPerson(
  writer: PartWriter,
  [givenName, familyName]: readonly [string, string],
  email: string,
): Promise<string> {
  const { insert, tenantId } = writer;
  const id = await insert('party.party', { tenant_id: tenantId, kind: 'person' });
  await insert('party.person', {
    tenant_id: tenantId,
    id,
    given_name: givenName,
    family_name: familyName,
    email,
  });
  return id;
}

/** An address under the tenant's .example domain, from a name with its accents taken off. */
export const personEmail = (
  tenant: Tenant,
  label: string,
  [givenName, familyName]: readonly [string, string],
): string =>
  `${givenName}.${familyName}@${label}.${tenant.slug}.example`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
