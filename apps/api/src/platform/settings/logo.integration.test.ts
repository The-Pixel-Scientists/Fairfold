// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The logo routes through the whole API against the test database, as
// app_api: the checks on the decoded bytes, what is stored and recorded, and
// two tenants.

import { createHash } from 'node:crypto';

import { messages } from '@pixel-scientists/domain/platform';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import {
  addMember,
  events,
  ok,
  png,
  startSettingsApi,
  versions,
  type Member,
  type SettingsApi,
} from '../../../test/settings-api.ts';
import { LOGO_BODY_LIMIT_BYTES } from './logo.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let app: SettingsApi;
let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let adminB: Member;

beforeAll(async () => {
  app = await startSettingsApi('41005');
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await app.close();
});

const call = (...args: Parameters<SettingsApi['call']>) => app.call(...args);

describe('the logo', () => {
  const upload = (member: Member, bytes: Buffer | string) =>
    call(member, 'PUT', '/theme/logo', {
      data: typeof bytes === 'string' ? bytes : bytes.toString('base64'),
    });

  const refusedAt = (response: LightMyRequestResponse) => {
    expect(response.statusCode, response.body).toBe(400);
    return response.json<{ errors: { field: string; message: string }[] }>().errors;
  };

  it('refuses an SVG, a renamed file, an animation and one that is too big', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
    const executable = Buffer.from('MZ\u0090\u0000\u0003\u0000\u0000\u0000', 'latin1');
    for (const bytes of [svg, jpeg, executable]) {
      expect(refusedAt(await upload(adminA, bytes))).toEqual([
        { field: 'body.data', message: messages.logoType },
      ]);
    }
    expect(refusedAt(await upload(adminA, png(40, 20, true)))).toEqual([
      { field: 'body.data', message: messages.logoAnimated },
    ]);
    expect(refusedAt(await upload(adminA, png(1201, 400)))).toEqual([
      { field: 'body.data', message: messages.logoTooBig },
    ]);
    expect(refusedAt(await upload(adminA, png(0, 0)))).toEqual([
      { field: 'body.data', message: messages.logoUnreadable },
    ]);
    const big = Buffer.concat([png(), Buffer.alloc(200 * 1024)]);
    const tooLarge = refusedAt(await upload(adminA, big));
    expect(tooLarge.length).toBeGreaterThan(0);
    expect(
      tooLarge.every((e) => e.field === 'body.data' && e.message === messages.logoTooLarge),
    ).toBe(true);
    expect((await upload(adminA, 'not base64 !')).statusCode).toBe(400);
    expect(await versions(tenantA, 'platform.theme')).toEqual([]);
  });

  it('refuses a body larger than the logo route’s limit, and a body naming other fields', async () => {
    const huge = await call(adminA, 'PUT', '/theme/logo', {
      data: 'A'.repeat(LOGO_BODY_LIMIT_BYTES),
    });
    expect(huge.statusCode).toBe(413);

    const extra = await call(adminA, 'PUT', '/theme/logo', {
      data: png().toString('base64'),
      type: 'image/svg+xml',
    });
    expect(extra.statusCode).toBe(400);
  });

  it('stores a checked logo, and records its digest, never its bytes', async () => {
    const bytes = png(300, 100);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    expect(await ok(upload(adminA, bytes))).toMatchObject({ hasLogo: true });
    expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({ hasLogo: true });

    const stored = await asMigratorIn(tenantA.id, async (client) => {
      const { rows } = await client.query<{ logo: Buffer; logo_type: string }>(
        'SELECT logo, logo_type FROM app.tenant_theme',
      );
      return rows[0];
    });
    expect(stored?.logo.equals(bytes)).toBe(true);
    expect(stored?.logo_type).toBe('image/png');

    const all = await versions(tenantA, 'platform.theme');
    expect(all.at(-1)).toMatchObject({
      version: 1,
      diff: { changes: [{ field: 'logo', from: null, to: { type: 'image/png', sha256 } }] },
    });
    const [event] = (await events(tenantA, 'platform.theme.changed')).slice(-1);
    expect(event?.changes).toEqual({
      'app.tenant_theme.logo_type': { after: 'image/png' },
      'app.tenant_theme.logo': { after: sha256 },
    });
    expect(JSON.stringify([all, event])).not.toContain(bytes.toString('base64'));
  });

  it('writes nothing for the same logo again, and a new version for a different one', async () => {
    await ok(upload(adminA, png(300, 100)));
    expect(await versions(tenantA, 'platform.theme')).toHaveLength(1);

    await ok(upload(adminA, png(310, 100)));
    expect(await versions(tenantA, 'platform.theme')).toHaveLength(2);
  });

  it('keeps the logo when the colour changes', async () => {
    await ok(call(adminA, 'PUT', '/theme', { brandColour: '#0b5394', preset: 'rounded' }));

    expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({
      brandColour: '#0b5394',
      hasLogo: true,
    });
  });

  it('is removed with a version and an audit event, and removing none changes nothing', async () => {
    expect(await ok(call(adminA, 'DELETE', '/theme/logo'))).toMatchObject({ hasLogo: false });

    const all = await versions(tenantA, 'platform.theme');
    expect(all.at(-1)?.diff.changes).toMatchObject([{ field: 'logo', to: null }]);
    const count = all.length;
    await ok(call(adminA, 'DELETE', '/theme/logo'));
    expect(await versions(tenantA, 'platform.theme')).toHaveLength(count);
  });

  it('never reaches another tenant’s theme', async () => {
    await ok(upload(adminB, png(50, 50)));

    expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({ hasLogo: false });
    expect(await ok(call(adminB, 'GET', '/theme'))).toMatchObject({ hasLogo: true });
  });
});
