// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Details as submitted (ADR 0017). A snapshot is written in the caller's
// request transaction, so it commits or rolls back with the submission. The
// caller names only the organisation: the member comes from the session, and
// the database copies the details and sets the tenant and the time
// (migration 0019). Nothing here updates or deletes a snapshot.

import type { AuditChanges } from '@pixel-scientists/db';
import type { Id } from '@pixel-scientists/domain';

import {
  organisationSnapshotSchema,
  type LegalForm,
  type OrganisationSnapshot,
  type PartyAuditAction,
} from '../contracts/index.ts';
import type { Tx } from './tables.ts';

/** What the snapshot contract reads from the request: its transaction, member and audit writer. */
export interface SnapshotContext {
  readonly tx: Tx;
  readonly membership: { readonly id: string };
  readonly audit: {
    record(event: {
      readonly action: PartyAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
  };
}

/** A column the database fills in, so an insert may leave it out. */
type Set<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: never;
};

type SnapshotTables = {
  'party.organisation_snapshot': {
    tenant_id: Set<string>;
    id: Set<string>;
    organisation_id: string;
    name: Set<string>;
    legal_form: Set<LegalForm>;
    address_line1: Set<string>;
    address_line2: Set<string | null>;
    address_town: Set<string>;
    address_postcode: Set<string>;
    address_country_code: Set<string>;
    website: Set<string | null>;
    identifiers: Set<unknown>;
    taken_by: string;
    taken_at: Set<Date>;
  };
};

const snapshotsDb = (tx: Tx) => tx.$extendTables<SnapshotTables>();

const table = 'party.organisation_snapshot';

export async function takeOrganisationSnapshot(
  { tx, membership, audit }: SnapshotContext,
  organisationId: Id,
): Promise<Id> {
  const row = await snapshotsDb(tx)
    .insertInto(table)
    .values({ organisation_id: organisationId, taken_by: membership.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  await audit.record({
    action: 'party.organisation_snapshot.created',
    entityId: row.id,
    changes: {
      [`${table}.id`]: { after: row.id },
      [`${table}.organisation_id`]: { after: organisationId },
    },
  });
  return row.id;
}

/** One snapshot of the caller's tenant, or null for an id that is not there. */
export async function readOrganisationSnapshot(
  { tx }: Pick<SnapshotContext, 'tx'>,
  snapshotId: Id,
): Promise<OrganisationSnapshot | null> {
  const row = await snapshotsDb(tx)
    .selectFrom(table)
    .selectAll()
    .where('id', '=', snapshotId)
    .executeTakeFirst();
  if (row === undefined) return null;
  return organisationSnapshotSchema.parse({
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    legalForm: row.legal_form,
    registeredAddress: {
      line1: row.address_line1,
      line2: row.address_line2,
      town: row.address_town,
      postcode: row.address_postcode,
      countryCode: row.address_country_code,
    },
    website: row.website,
    identifiers: row.identifiers,
    takenBy: row.taken_by,
    takenAt: row.taken_at.toISOString(),
  });
}
