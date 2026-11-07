// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Passkeys as auth.passkey keeps them (migration 0030), reached as app_auth.
// Every query names the user, who comes from the session, so a passkey of
// anyone else is never found: it answers as an unknown id. Every passkey was
// registered with user verification, so each one counts as a factor.

import type { Kysely, Transaction } from '@pixel-scientists/db';

import type { AuthTables } from '../tables.ts';

/** What the user sees of a passkey: never its credential id or public key. */
export interface PasskeyView {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/** How many passkeys the user holds, read in `trx`. */
export async function passkeyCount(trx: Transaction<unknown>, userId: string): Promise<number> {
  const { count } = await trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.passkey')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(count);
}

/** The user's passkeys, oldest first. */
export async function passkeysOf(db: Kysely<unknown>, userId: string): Promise<PasskeyView[]> {
  const rows = await db
    .$extendTables<AuthTables>()
    .selectFrom('auth.passkey')
    .select(['id', 'name', 'created_at', 'last_used_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  }));
}

/** The name of the user's passkey `id`, read in `trx`, or undefined if they have none such. */
export async function passkeyName(
  trx: Transaction<unknown>,
  userId: string,
  id: string,
): Promise<string | undefined> {
  const row = await trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.passkey')
    .select('name')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.name;
}

/** Delete the user's passkey `id` in `trx`. */
export async function deletePasskey(
  trx: Transaction<unknown>,
  userId: string,
  id: string,
): Promise<void> {
  await trx
    .$extendTables<AuthTables>()
    .deleteFrom('auth.passkey')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute();
}
