// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the settings screens: an administrator's session and the
// API's usual answers. Not part of the app.

import { screen } from '@testing-library/react';

import { consoleSession } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';

export const administrator = () => consoleSession({ roles: ['tenant_admin'] });

export const SESSION = 'GET /auth/session';

export const ok = (body: unknown): Reply => ({ status: 200, body });

export const theme = (
  change: Partial<{ brandColour: string; preset: string; hasLogo: boolean }> = {},
) => ({
  brandColour: '#1f4bb8',
  preset: 'standard',
  hasLogo: false,
  ...change,
});

export const publicTenant = (
  change: Parameters<typeof theme>[0] = {},
  name = 'Northfield Foundation',
) => ({
  name,
  theme: theme(change),
});

export const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

/** The first bytes of a PNG: the signature and a header for an image of this size. */
export function pngHeader(
  width: number,
  height: number,
  extra: readonly number[] = [],
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(33 + extra.length));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set(extra, 33);
  return bytes;
}

export const file = (bytes: BlobPart, name = 'logo.png', type = 'image/png') =>
  new File([bytes], name, { type });
