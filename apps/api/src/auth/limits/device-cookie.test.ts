// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import {
  DEVICE_LIFETIME,
  deviceCookie,
  deviceKeys,
  newDeviceId,
  readDeviceCookie,
  type DeviceCookie,
} from './device-cookie.ts';

const SECRET = randomBytes(32).toString('base64url');
const keys = deviceKeys(new Secret(SECRET));
const now = Date.now();
const fresh = (): DeviceCookie => ({
  version: 1,
  deviceId: newDeviceId(),
  userId: randomUUID(),
  issuedAt: Math.floor(now / 1000),
});

/** The name=value pair of a Set-Cookie header, as a browser sends it back. */
const sent = (header: string) => header.split(';', 1)[0] ?? '';
const read = (header: string, at = now) => readDeviceCookie(keys, sent(header), 'portal', at);

describe('the device cookie', () => {
  it('is a __Host- cookie for 12 months, one name per app, with no email address or tenant', () => {
    const cookie = fresh();
    const header = deviceCookie('console', keys, cookie);
    expect(header).toMatch(
      /^__Host-tps_console_device=1\.[A-Za-z0-9_-]{43}\.[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000$/,
    );
    expect(DEVICE_LIFETIME).toBe(31_536_000);
    expect(deviceCookie('portal', keys, cookie)).toMatch(/^__Host-tps_portal_device=/);
    expect(header).not.toContain('@');
  });

  it('carries 256 random bits as its device id', () => {
    const ids = new Set(Array.from({ length: 100 }, newDeviceId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(Buffer.from(id, 'base64url')).toHaveLength(32);
  });

  it("reads back what it signed, in the app's own cookie only", () => {
    const cookie = fresh();
    const header = deviceCookie('portal', keys, cookie);
    expect(read(header)).toEqual(cookie);
    expect(readDeviceCookie(keys, `theme=dark; ${sent(header)}`, 'portal', now)).toEqual(cookie);
    expect(readDeviceCookie(keys, sent(header), 'console', now)).toBeUndefined();
    expect(readDeviceCookie(keys, `${sent(header)}; ${sent(header)}`, 'portal', now)).toBe(
      undefined,
    );
    expect(readDeviceCookie(keys, undefined, 'portal', now)).toBeUndefined();
  });

  it('counts a tampered, forged or auth-secret-signed cookie as none', () => {
    const cookie = fresh();
    const header = deviceCookie('portal', keys, cookie);
    const other = deviceCookie('portal', deviceKeys(new Secret(`${SECRET}, another`)), cookie);
    expect(read(other)).toBeUndefined();
    expect(read(header.replace(cookie.userId, randomUUID()))).toBeUndefined();
    expect(
      read(header.replace(`.${String(cookie.issuedAt)}.`, `.${String(cookie.issuedAt - 1)}.`)),
    ).toBe(undefined);

    const payload = `1.${cookie.deviceId}.${cookie.userId}.${String(cookie.issuedAt)}`;
    const raw = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(read(`__Host-tps_portal_device=${payload}.${raw}`)).toBeUndefined();
    expect(read(`__Host-tps_portal_device=${payload}`)).toBeUndefined();
  });

  it('counts a cookie under an unknown key version as none', () => {
    const later = { current: 2, keys: new Map([[2, Buffer.alloc(32, 7)]]) };
    const header = deviceCookie('portal', later, { ...fresh(), version: 2 });
    expect(read(header)).toBeUndefined();
    expect(readDeviceCookie(later, sent(header), 'portal', now)).toBeDefined();
  });

  it('counts a cookie 12 months old, or issued in the future, as none', () => {
    const header = deviceCookie('portal', keys, fresh());
    expect(read(header, now + (DEVICE_LIFETIME - 60) * 1000)).toBeDefined();
    expect(read(header, now + DEVICE_LIFETIME * 1000)).toBeUndefined();
    expect(read(header, now - 600_000)).toBeUndefined();
  });
});
