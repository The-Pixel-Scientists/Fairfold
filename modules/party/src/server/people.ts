// SPDX-License-Identifier: AGPL-3.0-or-later
//
// People: the person made from an account (ADR 0017), their consent history,
// and the reads other modules make. Every function runs in the caller's
// transaction, so row-level security keeps it inside the tenant.

import type { Id } from '@pixel-scientists/domain';

import type { Consent, ContactDetails, PersonName } from '../contracts/index.ts';
import { partyDb, type PartyDb, type Tx } from './tables.ts';

export async function personIdForUser(tx: Tx, userId: string): Promise<Id | null> {
  const row = await partyDb(tx)
    .selectFrom('party.person')
    .select('id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * The person for an account in this tenant, made from the account's own
 * details if there is none. It never links an existing person by name or
 * email (ADR 0017). `created` tells the caller to write the audit event.
 */
export async function ensurePersonForUser(
  tx: Tx,
  account: { readonly userId: string; readonly email: string },
): Promise<{ readonly personId: Id; readonly created: boolean }> {
  const existing = await personIdForUser(tx, account.userId);
  if (existing !== null) return { personId: existing, created: false };

  // Two first requests from one account must not each add a party.
  await tx
    .selectNoFrom((eb) =>
      eb
        .fn('pg_advisory_xact_lock', [
          eb.fn('hashtextextended', [eb.val(`party.person:${account.userId}`), eb.val(0)]),
        ])
        .as('locked'),
    )
    .execute();
  const raced = await personIdForUser(tx, account.userId);
  if (raced !== null) return { personId: raced, created: false };

  const db = partyDb(tx);
  const party = await db
    .insertInto('party.party')
    .values((eb) => ({ tenant_id: eb.fn<string>('app.current_tenant_id', []), kind: 'person' }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('party.person')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      id: party.id,
      email: account.email.trim().toLowerCase(),
      user_id: account.userId,
    }))
    .execute();
  return { personId: party.id, created: true };
}

/** Display names by account id, for the accounts that have a person here. */
export async function peopleByUserIds(
  tx: Tx,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, PersonName>> {
  if (userIds.length === 0) return new Map();
  const rows = await partyDb(tx)
    .selectFrom('party.person')
    .select(['id', 'user_id', 'given_name', 'family_name'])
    .where('user_id', 'in', userIds)
    .execute();
  return new Map(
    rows.flatMap((row) =>
      row.user_id === null
        ? []
        : [
            [
              row.user_id,
              { personId: row.id, givenName: row.given_name, familyName: row.family_name },
            ] as const,
          ],
    ),
  );
}

export async function contactDetails(tx: Tx, personId: string): Promise<ContactDetails | null> {
  const row = await partyDb(tx)
    .selectFrom('party.person')
    .select(['given_name', 'email'])
    .where('id', '=', personId)
    .executeTakeFirst();
  return row === undefined ? null : { givenName: row.given_name, email: row.email };
}

export async function isCurrentContact(
  tx: Tx,
  personId: string,
  organisationId: string,
): Promise<boolean> {
  const row = await partyDb(tx)
    .selectFrom('party.relationship')
    .select('id')
    .where('type', '=', 'contact_for')
    .where('subject_id', '=', personId)
    .where('object_id', '=', organisationId)
    .where('ends_on', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

/** The latest choice for each purpose and channel. */
export async function currentConsents(db: PartyDb, personId: string): Promise<Consent[]> {
  const rows = await db
    .selectFrom('party.consent')
    .select(['purpose', 'channel', 'state', 'privacy_notice_version', 'recorded_at'])
    .distinctOn(['purpose', 'channel'])
    .where('person_id', '=', personId)
    .orderBy('purpose')
    .orderBy('channel')
    .orderBy('recorded_at', 'desc')
    .execute();
  return rows.map((row) => ({
    purpose: row.purpose,
    channel: row.channel,
    state: row.state,
    privacyNoticeVersion: row.privacy_notice_version,
    recordedAt: row.recorded_at.toISOString(),
  }));
}
