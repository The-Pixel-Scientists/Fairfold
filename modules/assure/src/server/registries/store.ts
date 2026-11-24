// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The snapshot store (ADR 0031): the only place assure's lookup tables are
// read and written for registries. A snapshot is inserted, never changed or
// deleted, so a failed refresh leaves the last good one. Columns are the
// ones the classification map lists; the tenant is the transaction's own,
// and the fetched time is the database's. Nothing here reads or writes a
// party table.

import type { Transaction } from '@pixel-scientists/db';
import type { DB } from '@pixel-scientists/db/generated/assure';
import { moduleOn } from '@pixel-scientists/domain/platform';

import {
  registries,
  type LookupSnapshot,
  type Registry,
  type RegistryResult,
} from '../../contracts/index.ts';

export type Tx = Transaction<unknown>;

type Tables = Omit<DB, never> & {
  'app.tenant_module': { module: string; enabled: boolean };
  'app.audit_event': { job_id: string | null; action: string };
};

const assureDb = (tx: Tx) => tx.$extendTables<Tables>();

/** Whether the tenant has switched assure on; a missing row is off (ADR 0024). */
export async function assureIsOn(tx: Tx): Promise<boolean> {
  const row = await assureDb(tx)
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', 'assure')
    .executeTakeFirst();
  return moduleOn('assure', row?.enabled);
}

/**
 * Whether party has erased the organisation. Its identifiers outlive the
 * erasure, but nothing about an erased party is looked up or stored again
 * (ADR 0027), and the database refuses a snapshot for one.
 */
export async function organisationIsErased(tx: Tx, organisationId: string): Promise<boolean> {
  const row = await assureDb(tx)
    .selectNoFrom((eb) =>
      eb
        .fn<boolean>('party.is_erased', [
          eb.fn('app.current_tenant_id', []),
          eb.val(organisationId),
        ])
        .as('erased'),
    )
    .executeTakeFirstOrThrow();
  return row.erased;
}

/** Whether this job has already recorded its refresh, so a second delivery adds nothing. */
export async function refreshRecorded(tx: Tx, jobId: string): Promise<boolean> {
  const row = await assureDb(tx)
    .selectFrom('app.audit_event')
    .select('job_id')
    .where('job_id', '=', jobId)
    .where('action', '=', 'assure.lookup.refreshed')
    .executeTakeFirst();
  return row !== undefined;
}

/** Inserts a snapshot and its officers: of an entry found, or with no result, one not found. */
export async function insertSnapshot(
  tx: Tx,
  organisationId: string,
  registry: Registry,
  identifier: string,
  result: RegistryResult | null,
): Promise<string> {
  const db = assureDb(tx);
  const address = result?.registeredAddress;
  const accounts = result?.accounts;
  const found =
    result === null
      ? {}
      : {
          registry_status: result.status,
          registered_name: result.registeredName,
          address_line1: address?.line1 ?? null,
          address_line2: address?.line2 ?? null,
          address_town: address?.town ?? null,
          address_postcode: address?.postcode ?? null,
          address_country_code: address?.countryCode ?? null,
          registered_on: result.registeredOn,
          removed_on: result.removedOn,
          accounts_period_end: accounts?.periodEnd ?? null,
          income_minor: accounts?.income?.amountMinor ?? null,
          income_currency: accounts?.income?.currency ?? null,
          expenditure_minor: accounts?.expenditure?.amountMinor ?? null,
          expenditure_currency: accounts?.expenditure?.currency ?? null,
          accounts_overdue: result.accountsOverdue,
        };
  const { id } = await db
    .insertInto('assure.lookup_snapshot')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      organisation_id: organisationId,
      registry,
      scheme: registries[registry],
      identifier,
      outcome: result === null ? 'not_found' : 'found',
      ...found,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  if (result !== null && result.officers.length > 0) {
    await db
      .insertInto('assure.lookup_officer')
      .values((eb) =>
        result.officers.map(({ name, role }) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          snapshot_id: id,
          name,
          role,
        })),
      )
      .execute();
  }
  return id;
}

/** The newest snapshot of one identifier on one register, with a count of its officers and none of their names. */
export async function latestSnapshot(
  tx: Tx,
  organisationId: string,
  registry: Registry,
  identifier: string,
): Promise<LookupSnapshot | null> {
  const row = await assureDb(tx)
    .selectFrom('assure.lookup_snapshot as s')
    .select((eb) => [
      's.id',
      's.identifier',
      's.fetched_at',
      's.outcome',
      's.registry_status',
      's.registered_name',
      's.address_line1',
      's.address_line2',
      's.address_town',
      's.address_postcode',
      's.address_country_code',
      eb.cast<string | null>('s.registered_on', 'text').as('registered_on'),
      eb.cast<string | null>('s.removed_on', 'text').as('removed_on'),
      eb.cast<string | null>('s.accounts_period_end', 'text').as('accounts_period_end'),
      's.income_minor',
      's.income_currency',
      's.expenditure_minor',
      's.expenditure_currency',
      's.accounts_overdue',
      eb
        .selectFrom('assure.lookup_officer as o')
        .select((count) => count.fn.countAll<string>().as('n'))
        .whereRef('o.snapshot_id', '=', 's.id')
        .as('officer_count'),
    ])
    .where('s.organisation_id', '=', organisationId)
    .where('s.registry', '=', registry)
    .where('s.identifier', '=', identifier)
    .orderBy('s.fetched_at', 'desc')
    .orderBy('s.id')
    .limit(1)
    .executeTakeFirst();
  if (row === undefined) return null;
  const money = (minor: string | null, currency: string | null) =>
    minor === null || currency === null
      ? null
      : { amountMinor: Number(minor), currency: currency as 'GBP' };
  return {
    id: row.id,
    registry,
    identifier: row.identifier,
    fetchedAt: row.fetched_at.toISOString(),
    outcome: row.outcome === 'found' ? 'found' : 'not_found',
    details:
      row.outcome !== 'found'
        ? null
        : {
            status: row.registry_status as RegistryResult['status'],
            registeredName: row.registered_name ?? '',
            registeredAddress:
              row.address_line1 === null
                ? null
                : {
                    line1: row.address_line1,
                    line2: row.address_line2,
                    town: row.address_town ?? '',
                    postcode: row.address_postcode ?? '',
                    countryCode: row.address_country_code ?? '',
                  },
            registeredOn: row.registered_on,
            removedOn: row.removed_on,
            accounts:
              row.accounts_period_end === null
                ? null
                : {
                    periodEnd: row.accounts_period_end,
                    income: money(row.income_minor, row.income_currency),
                    expenditure: money(row.expenditure_minor, row.expenditure_currency),
                  },
            accountsOverdue: row.accounts_overdue,
            officerCount: Number(row.officer_count ?? 0),
          },
  };
}

/** The organisation a snapshot is about, or null when this tenant has no such snapshot. */
export async function snapshotOrganisation(tx: Tx, snapshotId: string): Promise<string | null> {
  const row = await assureDb(tx)
    .selectFrom('assure.lookup_snapshot')
    .select('organisation_id')
    .where('id', '=', snapshotId)
    .executeTakeFirst();
  return row?.organisation_id ?? null;
}

export async function snapshotOfficers(tx: Tx, snapshotId: string) {
  const rows = await assureDb(tx)
    .selectFrom('assure.lookup_officer')
    .select(['id', 'name', 'role', 'person_id'])
    .where('snapshot_id', '=', snapshotId)
    .orderBy('name')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role as RegistryResult['officers'][number]['role'],
    personId: row.person_id,
  }));
}

/**
 * Organisations whose newest snapshot on one of `within` was fetched before
 * `before`, the oldest first, at most `limit`: what the scheduled refresh
 * looks up again. An erased organisation is left out, so it never uses one of
 * the `limit` places.
 */
export async function staleLookups(
  tx: Tx,
  within: readonly Registry[],
  before: Date,
  limit: number,
): Promise<{ organisationId: string; registry: Registry }[]> {
  if (within.length === 0) return [];
  const rows = await assureDb(tx)
    .selectFrom('assure.lookup_snapshot as s')
    .select(['s.organisation_id', 's.registry'])
    .where('s.registry', 'in', [...within])
    .where('s.fetched_at', '<', before)
    .where((eb) =>
      eb.not(
        eb.fn<boolean>('party.is_erased', [
          eb.fn('app.current_tenant_id', []),
          eb.ref('s.organisation_id'),
        ]),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('assure.lookup_snapshot as newer')
            .select('newer.id')
            .whereRef('newer.organisation_id', '=', 's.organisation_id')
            .whereRef('newer.registry', '=', 's.registry')
            .whereRef('newer.fetched_at', '>', 's.fetched_at'),
        ),
      ),
    )
    .orderBy('s.fetched_at')
    .orderBy('s.id')
    .limit(limit)
    .execute();
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const key = `${row.organisation_id}:${row.registry}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ organisationId: row.organisation_id, registry: row.registry as Registry }];
  });
}

/** An officer's organisation and the person it is linked to, locked for a link; null when this tenant has no such officer. */
export async function lockOfficer(
  tx: Tx,
  officerId: string,
): Promise<{ organisationId: string; personId: string | null } | null> {
  const row = await assureDb(tx)
    .selectFrom('assure.lookup_officer as o')
    .innerJoin('assure.lookup_snapshot as s', 's.id', 'o.snapshot_id')
    .select(['s.organisation_id', 'o.person_id'])
    .where('o.id', '=', officerId)
    .forUpdate('o')
    .executeTakeFirst();
  return row === undefined
    ? null
    : { organisationId: row.organisation_id, personId: row.person_id };
}

/** Links an officer that has no person yet to `personId`, as the member; the database sets the time. */
export async function linkOfficer(tx: Tx, officerId: string, personId: string, member: string) {
  const row = await assureDb(tx)
    .updateTable('assure.lookup_officer')
    .set({ person_id: personId, linked_by: member })
    .where('id', '=', officerId)
    .where('person_id', 'is', null)
    .returning(['id', 'name', 'role', 'person_id'])
    .executeTakeFirstOrThrow();
  return {
    id: row.id,
    name: row.name,
    role: row.role as RegistryResult['officers'][number]['role'],
    personId: row.person_id,
  };
}
