// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The device cookie (ADR 0010, "Sign-in limits and passwords"). It holds a
// random device id, the account id, the issue time and the key version,
// never an email address or tenant, signed with HMAC-SHA-256 under the
// device purpose key, which HKDF-SHA-256 derives from the auth secret. Each
// app has its own, with the session cookie's attributes, for 12 months. A
// cookie that fails any check here counts as no cookie.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import type { App } from '@pixel-scientists/domain/platform';

import type { Secret } from '../../config.ts';
import { ATTRIBUTES, readCookie } from '../cookies.ts';

export const DEVICE_COOKIES: Readonly<Record<App, string>> = {
  console: '__Host-tps_console_device',
  portal: '__Host-tps_portal_device',
};

/** 12 months, in seconds. */
export const DEVICE_LIFETIME = 365 * 24 * 3600;

/** A clock running this far ahead of ours still issues cookies we accept. */
const SKEW = 300;

/** The device purpose keys by version, and the version that signs new cookies. */
export interface DeviceKeys {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export function deviceKeys(secret: Secret): DeviceKeys {
  const key = Buffer.from(hkdfSync('sha256', secret.reveal(), '', 'tps-auth-device', 32));
  return { current: 1, keys: new Map([[1, key]]) };
}

export interface DeviceCookie {
  readonly version: number;
  /** 256 random bits, as base64url. */
  readonly deviceId: string;
  readonly userId: string;
  /** Seconds since the epoch. */
  readonly issuedAt: number;
}

const VALUE =
  /^([1-9]\d{0,3})\.([A-Za-z0-9_-]{43})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,11})\.([A-Za-z0-9_-]{43})$/;

export function newDeviceId(): string {
  return randomBytes(32).toString('base64url');
}

function signature(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** The Set-Cookie header for a new device cookie, signed under the current key. */
export function deviceCookie(app: App, keys: DeviceKeys, cookie: DeviceCookie): string {
  const key = keys.keys.get(cookie.version);
  if (key === undefined) throw new Error('A device cookie needs a known key version.');
  const payload = `${String(cookie.version)}.${cookie.deviceId}.${cookie.userId}.${String(cookie.issuedAt)}`;
  const value = `${payload}.${signature(key, payload)}`;
  return `${DEVICE_COOKIES[app]}=${value}; ${ATTRIBUTES}; Max-Age=${String(DEVICE_LIFETIME)}`;
}

/**
 * The app's device cookie in the header, if there is exactly one, it is
 * signed under a known key version, and it is under 12 months old.
 */
export function readDeviceCookie(
  keys: DeviceKeys,
  cookieHeader: string | undefined,
  app: App,
  now = Date.now(),
): DeviceCookie | undefined {
  const match = VALUE.exec(readCookie(cookieHeader, DEVICE_COOKIES[app]) ?? '');
  if (match === null) return undefined;
  const [, version = '', deviceId = '', userId = '', issued = '', signed = ''] = match;
  const key = keys.keys.get(Number(version));
  if (key === undefined) return undefined;
  // Both are 43 characters, as the pattern requires.
  const expected = signature(key, `${version}.${deviceId}.${userId}.${issued}`);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signed))) return undefined;
  const issuedAt = Number(issued);
  const age = Math.floor(now / 1000) - issuedAt;
  if (age < -SKEW || age >= DEVICE_LIFETIME) return undefined;
  return { version: Number(version), deviceId, userId, issuedAt };
}
