// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Details as submitted (ADR 0017): in the submit transaction, grants asks
// party to snapshot the organisation and keeps the snapshot's id. A
// snapshot is evidence: no contract updates, deletes or re-points one.

import { idSchema, type Id } from '@pixel-scientists/domain';
import { z } from 'zod';

import { addressSchema } from './answers.ts';
import { identifierSchemeSchema } from './identifiers.ts';
import { legalFormSchema } from './lists.ts';

/** An identifier as it was: verified when `verifiedAt` is set, otherwise an unverified claim. */
export const snapshotIdentifierSchema = z.strictObject({
  scheme: identifierSchemeSchema,
  identifier: z.string(),
  verifiedAt: z.iso.datetime().nullable(),
});

/** One snapshot, field for field as ADR 0017 lists them. Identifiers are in scheme, then identifier, order. */
export const organisationSnapshotSchema = z.strictObject({
  id: idSchema,
  organisationId: idSchema,
  name: z.string(),
  legalForm: legalFormSchema,
  registeredAddress: z.strictObject(addressSchema.shape),
  website: z.string().nullable(),
  identifiers: z.array(snapshotIdentifierSchema),
  /** The membership that submitted. */
  takenBy: idSchema,
  takenAt: z.iso.datetime(),
});

export type OrganisationSnapshot = z.infer<typeof organisationSnapshotSchema>;

/**
 * The party server's snapshot contract. `Ctx` is the caller's request
 * context: its tenant transaction and session. The tenant and the member
 * come from it, never from an argument.
 */
export interface OrganisationSnapshots<Ctx> {
  /** Copies the organisation as it is now, writes `party.organisation_snapshot.created`, and answers the snapshot's id. */
  takeOrganisationSnapshot(ctx: Ctx, organisationId: Id): Promise<Id>;
  /** Null for an id not in the tenant. */
  readOrganisationSnapshot(ctx: Ctx, snapshotId: Id): Promise<OrganisationSnapshot | null>;
}
