// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Known devices for sign-in limits (ADR 0010, migration 0022), as app_auth.
// A device cookie gives relief only when its row agrees: stored under the
// SHA-256 of its id, for the account the identifier names, which is active,
// with the cookie's key version, unrevoked and under 12 months old. Then
// password and code attempts count per identifier and device alone; any
// other cookie counts as none, and the attempt counts against the address.
// It never gives a session, membership or tenant.
//
// A sign-in that completes, after password and any MFA, keeps the
// browser's device for its account, using it now, or issues a new one,
// which replaces a cookie for another account. Passkey and SSO sign-in
// (S11-83, S11-62) charge no password limits and call rememberDevice() when
// they complete. A password reset, "sign out everywhere" and deactivation
// call revokeDevices().

import { createHash } from 'node:crypto';

import type { Generated, Kysely, RateLimitClient, Transaction } from '@pixel-scientists/db';
import type { App } from '@pixel-scientists/domain/platform';

import type { AuthTables } from '../tables.ts';
import { deviceCookie, newDeviceId, readDeviceCookie, type DeviceKeys } from './device-cookie.ts';

type DeviceTables = AuthTables & {
  'auth.device': {
    id: Generated<string>;
    user_id: string;
    device_hash: Buffer;
    key_version: number;
    issued_at: Generated<Date>;
    last_used_at: Generated<Date>;
    revoked_at: Date | null;
  };
};

const hashOf = (deviceId: string): Buffer => createHash('sha256').update(deviceId).digest();

export interface DeviceDependencies {
  /** As app_auth. */
  readonly auth: Kysely<unknown>;
  readonly devices: DeviceKeys;
  readonly client: (requestId: string) => { readonly cookie?: string };
}

/**
 * Who an attempt by the account at `email` counts against: the request's
 * device, if its cookie is valid for that account, and otherwise `client`.
 */
export async function countedClient(
  deps: DeviceDependencies,
  requestId: string,
  app: App,
  email: string,
  client: RateLimitClient,
): Promise<RateLimitClient> {
  const cookie = readDeviceCookie(deps.devices, deps.client(requestId).cookie, app);
  if (cookie === undefined) return client;
  const device = await deps.auth
    .$extendTables<DeviceTables>()
    .selectFrom('auth.device as d')
    .innerJoin('auth.user as u', 'u.id', 'd.user_id')
    .select('d.id')
    .where('d.device_hash', '=', hashOf(cookie.deviceId))
    .where('d.user_id', '=', cookie.userId)
    .where('d.key_version', '=', cookie.version)
    .where('d.revoked_at', 'is', null)
    .where((eb) => eb(eb.fn('age', [eb.fn('now'), 'd.issued_at']), '<', eb.val('12 months')))
    .where('u.email', '=', email)
    .where('u.status', '=', 'active')
    .executeTakeFirst();
  return device === undefined ? client : { ...client, device: device.id };
}

/**
 * At a completed sign-in, in its transaction: mark the browser's device for
 * `userId` used, or issue a new one. Returns the Set-Cookie header to send
 * once the transaction commits, if there is a new cookie.
 */
export async function rememberDevice(
  trx: Transaction<unknown>,
  deps: Pick<DeviceDependencies, 'devices' | 'client'>,
  requestId: string,
  app: App,
  userId: string,
): Promise<string | undefined> {
  const db = trx.$extendTables<DeviceTables>();
  const cookie = readDeviceCookie(deps.devices, deps.client(requestId).cookie, app);
  if (cookie?.userId === userId) {
    const used = await db
      .updateTable('auth.device')
      .set((eb) => ({ last_used_at: eb.fn<Date>('now') }))
      .where('device_hash', '=', hashOf(cookie.deviceId))
      .where('user_id', '=', userId)
      .where('key_version', '=', cookie.version)
      .where('revoked_at', 'is', null)
      .where((eb) => eb(eb.fn('age', [eb.fn('now'), 'issued_at']), '<', eb.val('12 months')))
      .executeTakeFirst();
    if (used.numUpdatedRows > 0n) return undefined;
  }
  const deviceId = newDeviceId();
  const version = deps.devices.current;
  const { issued_at } = await db
    .insertInto('auth.device')
    .values({ user_id: userId, device_hash: hashOf(deviceId), key_version: version })
    .returning('issued_at')
    .executeTakeFirstOrThrow();
  const issuedAt = Math.floor(issued_at.getTime() / 1000);
  return deviceCookie(app, deps.devices, { version, deviceId, userId, issuedAt });
}

/** Revoke every device of the account, in the caller's transaction. Returns how many. */
export async function revokeDevices(trx: Transaction<unknown>, userId: string): Promise<number> {
  const result = await trx
    .$extendTables<DeviceTables>()
    .updateTable('auth.device')
    .set((eb) => ({ revoked_at: eb.fn<Date>('now') }))
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/**
 * Delete up to `limit` devices 12 months after issue or 30 days after
 * revocation, as the classification sets out. Returns how many. The
 * database refuses to delete any other.
 */
export async function deleteExpiredDevices(db: Kysely<unknown>, limit = 1000): Promise<number> {
  const devices = db.$extendTables<DeviceTables>();
  const result = await devices
    .deleteFrom('auth.device')
    .where('id', 'in', (eb) =>
      eb
        .selectFrom('auth.device')
        .select('id')
        .where((old) =>
          old.or([
            old(old.fn('age', [old.fn('now'), 'issued_at']), '>=', old.val('12 months')),
            old(old.fn('age', [old.fn('now'), 'revoked_at']), '>=', old.val('30 days')),
          ]),
        )
        .limit(limit),
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
