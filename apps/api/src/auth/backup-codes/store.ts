// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The backup code set in auth.two_factor.backup_codes, as app_auth. A set
// lives only beside a confirmed authenticator (the column's check, migration
// 0025), so every function here reads or writes the confirmed row only.
// Writes run in the caller's transaction, which holds a lock on the user.

import type { Kysely, Transaction } from '@pixel-scientists/db';

import type { AuthTables } from '../tables.ts';
import {
  codeSet,
  decodeSet,
  encodeSet,
  matchIndex,
  newCodes,
  type BackupCodeKeys,
} from './codes.ts';

const confirmed = (db: Kysely<unknown>, userId: string) =>
  db
    .$extendTables<AuthTables>()
    .selectFrom('auth.two_factor')
    .select('backup_codes')
    .where('user_id', '=', userId)
    .where('verified', '=', true);

const save = (trx: Transaction<unknown>, userId: string, stored: string | null) =>
  trx
    .$extendTables<AuthTables>()
    .updateTable('auth.two_factor')
    .set({ backup_codes: stored })
    .where('user_id', '=', userId)
    .where('verified', '=', true)
    .executeTakeFirst();

/** Replace the user's set with a new one: the codes, or undefined if they have no authenticator. */
export async function replaceCodes(
  trx: Transaction<unknown>,
  keys: BackupCodeKeys,
  userId: string,
): Promise<string[] | undefined> {
  const codes = newCodes();
  const saved = await save(trx, userId, encodeSet(codeSet(keys, userId, codes)));
  return saved.numUpdatedRows === 0n ? undefined : codes;
}

/**
 * Use `code` once. The user's row stays locked until `trx` ends, and the
 * matched code is removed in it. The number of codes left, or undefined if
 * `code` matches none.
 */
export async function useBackupCode(
  trx: Transaction<unknown>,
  keys: BackupCodeKeys,
  userId: string,
  code: string,
): Promise<number | undefined> {
  const row = await confirmed(trx, userId).forUpdate().executeTakeFirst();
  const set = decodeSet(row?.backup_codes ?? null) ?? { version: keys.current, hmacs: [] };
  const index = matchIndex(keys, userId, set, code);
  if (index < 0) return undefined;
  const hmacs = set.hmacs.filter((_, at) => at !== index);
  await save(trx, userId, encodeSet({ version: set.version, hmacs }));
  return hmacs.length;
}

/** How many codes the user has left. */
export async function countCodes(db: Kysely<unknown>, userId: string): Promise<number> {
  const row = await confirmed(db, userId).executeTakeFirst();
  return decodeSet(row?.backup_codes ?? null)?.hmacs.length ?? 0;
}

/** Remove the user's set, with the authenticator it backs up. */
export async function clearCodes(trx: Transaction<unknown>, userId: string): Promise<void> {
  await save(trx, userId, null);
}
