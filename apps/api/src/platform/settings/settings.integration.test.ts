// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The settings, theme and module routes through the whole API against the
// test database, as app_api: sessions, the policy, row-level security, the
// configuration versions and the audit log, for two tenants. The logo is in
// logo.integration.test.ts.

import { randomUUID } from 'node:crypto';

import { checkTheme, messages } from '@pixel-scientists/domain/platform';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestTenant, type TestTenant } from '../../../../../packages/db/test/tenants.ts';
import {
  addMember,
  events,
  ok,
  png,
  startSettingsApi,
  versions,
  type Member,
  type Method,
  type SettingsApi,
} from '../../../test/settings-api.ts';
import { tenantId } from '../../../test/support.ts';
import { ApiError } from '../../problems.ts';
import { recordConfigVersion } from '../config-versions.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let app: SettingsApi;
let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let managerA: Member;
let reviewerA: Member;
let applicantA: Member;
let adminB: Member;

beforeAll(async () => {
  app = await startSettingsApi('41003');
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  managerA = await addMember(tenantA, 'console', 'programme_manager');
  reviewerA = await addMember(tenantA, 'console', 'reviewer');
  applicantA = await addMember(tenantA, 'portal', 'applicant');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await app.close();
});

const call = (...args: Parameters<SettingsApi['call']>) => app.call(...args);
const grants = (member: Member) => app.grants(member);

describe('who may use the settings routes', () => {
  const requests: [Method, string, object | undefined][] = [
    ['GET', '', undefined],
    ['PUT', '', { name: 'Fund', timeZone: 'Europe/London', fiscalYearStartMonth: 4 }],
    ['GET', '/theme', undefined],
    ['PUT', '/theme', { brandColour: '#0b5394', preset: 'rounded' }],
    ['PUT', '/theme/logo', { data: png().toString('base64') }],
    ['DELETE', '/theme/logo', undefined],
    ['GET', '/modules', undefined],
    ['PATCH', '/modules', { module: 'grants', enabled: false }],
  ];

  it('refuse a holder of any other role, a portal session and a signed-out caller', async () => {
    for (const [method, path, payload] of requests) {
      for (const member of [managerA, reviewerA]) {
        const response = await call(member, method, path, payload);
        expect(response.statusCode, `${method} ${path} as ${member.membershipId}`).toBe(403);
      }
      const applicant = await call(applicantA, method, path, payload);
      expect(applicant.statusCode, `${method} ${path} as an applicant`).toBe(403);
      const signedOut = await call(undefined, method, path, payload);
      expect(signedOut.statusCode, `${method} ${path} signed out`).toBe(401);
    }
    expect(await versions(tenantA, 'platform.tenant')).toEqual([]);
    expect(await versions(tenantA, 'platform.theme')).toEqual([]);
    expect(await versions(tenantA, 'platform.module')).toEqual([]);
  });

  it('refuse a portal session for the administrator’s own account', async () => {
    expect((await app.asPortal(adminA)).statusCode).toBe(403);
  });
});

describe('general settings', () => {
  it('reads what the tenant has, and updates it with a version and an audit event', async () => {
    expect(await ok(call(adminA, 'GET', ''))).toEqual({
      name: 'Test tenant',
      timeZone: 'Europe/London',
      fiscalYearStartMonth: 4,
    });

    const changed = {
      name: '  Larkspur Fund ',
      timeZone: 'America/New_York',
      fiscalYearStartMonth: 1,
    };
    expect(await ok(call(adminA, 'PUT', '', changed))).toEqual({
      name: 'Larkspur Fund',
      timeZone: 'America/New_York',
      fiscalYearStartMonth: 1,
    });
    expect(await ok(call(adminA, 'GET', ''))).toMatchObject({ name: 'Larkspur Fund' });

    const [version] = await versions(tenantA, 'platform.tenant');
    expect(version).toMatchObject({
      version: 1,
      author_id: adminA.membershipId,
      entity_id: tenantA.id,
      diff: {
        changes: [
          { field: 'name', from: 'Test tenant', to: 'Larkspur Fund' },
          { field: 'timeZone', from: 'Europe/London', to: 'America/New_York' },
          { field: 'fiscalYearStartMonth', from: 4, to: 1 },
        ],
      },
    });
    const [event] = await events(tenantA, 'platform.tenant.updated');
    expect(event).toMatchObject({
      actor_id: adminA.membershipId,
      entity_id: tenantA.id,
      changes: {
        'app.tenant.name': { before: 'Test tenant', after: 'Larkspur Fund' },
        'app.tenant.timezone': { before: 'Europe/London', after: 'America/New_York' },
        'app.tenant.fiscal_year_start_month': { before: 4, after: 1 },
      },
    });
  });

  it('numbers the next version, and writes nothing for a change that alters nothing', async () => {
    const same = { name: 'Larkspur Fund', timeZone: 'America/New_York', fiscalYearStartMonth: 1 };
    await ok(call(adminA, 'PUT', '', same));
    expect(await versions(tenantA, 'platform.tenant')).toHaveLength(1);

    await ok(call(adminA, 'PUT', '', { ...same, fiscalYearStartMonth: 7 }));
    const all = await versions(tenantA, 'platform.tenant');
    expect(all.map((row) => row.version)).toEqual([1, 2]);
    expect(all[1]?.diff.changes).toEqual([{ field: 'fiscalYearStartMonth', from: 1, to: 7 }]);
    expect(await events(tenantA, 'platform.tenant.updated')).toHaveLength(2);
  });

  it('refuses an unknown time zone, a month out of range, a hidden character and extra keys', async () => {
    const valid = { name: 'Fund', timeZone: 'Europe/London', fiscalYearStartMonth: 4 };
    const bad: object[] = [
      { ...valid, timeZone: 'Mars/Olympus' },
      { ...valid, fiscalYearStartMonth: 13 },
      { ...valid, fiscalYearStartMonth: 0 },
      { ...valid, name: 'Fund\u202eevil' },
      { ...valid, name: '   ' },
      { ...valid, name: 'x'.repeat(101) },
      { ...valid, tenantId: tenantB.id },
      { ...valid, status: 'suspended' },
    ];
    for (const payload of bad) {
      const response = await call(adminA, 'PUT', '', payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(await ok(call(adminA, 'GET', ''))).toMatchObject({ timeZone: 'America/New_York' });
  });

  it('changes only the caller’s own tenant', async () => {
    const change = { name: 'Other Fund', timeZone: 'Asia/Tokyo', fiscalYearStartMonth: 10 };
    await ok(call(adminB, 'PUT', '', change));

    expect(await ok(call(adminA, 'GET', ''))).toMatchObject({ name: 'Larkspur Fund' });
    expect(await ok(call(adminB, 'GET', ''))).toEqual(change);
    expect(await versions(tenantB, 'platform.tenant')).toHaveLength(1);
    expect(
      (await versions(tenantA, 'platform.tenant')).every((row) => row.entity_id === tenantA.id),
    ).toBe(true);
    expect((await events(tenantB, 'platform.tenant.updated'))[0]?.actor_id).toBe(
      adminB.membershipId,
    );
  });
});

describe('the theme', () => {
  it('starts as the default look, with no logo', async () => {
    expect(await ok(call(adminA, 'GET', '/theme'))).toEqual({
      brandColour: '#1b1d21',
      preset: 'standard',
      hasLogo: false,
    });
  });

  it('refuses a colour that fails contrast, naming a colour that passes', async () => {
    const { suggestion } = checkTheme({ brandColour: '#aaaaaa' });
    expect(suggestion).not.toBeNull();

    const response = await call(adminA, 'PUT', '/theme', {
      brandColour: '#aaaaaa',
      preset: 'standard',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { field: string; message: string }[] }>().errors).toEqual([
      { field: 'body.brandColour', message: messages.brandColourContrast(suggestion ?? '') },
    ]);
    expect(await versions(tenantA, 'platform.theme')).toEqual([]);

    expect(checkTheme({ brandColour: suggestion ?? '' }).problems).toEqual([]);
  });

  it('refuses a colour that is not a hex code, and extra keys', async () => {
    for (const payload of [
      { brandColour: 'red', preset: 'standard' },
      { brandColour: 'url(x)', preset: 'standard' },
      { brandColour: '#0b5394', preset: 'fancy' },
      { brandColour: '#0b5394', preset: 'standard', hasLogo: true },
      { brandColour: '#0b5394', preset: 'standard', logo: 'x' },
    ]) {
      expect(
        (await call(adminA, 'PUT', '/theme', payload)).statusCode,
        JSON.stringify(payload),
      ).toBe(400);
    }
  });

  it('saves a colour and a preset, with a version and an audit event', async () => {
    const tokens = { brandColour: '#0B5394', preset: 'rounded' };
    expect(await ok(call(adminA, 'PUT', '/theme', tokens))).toEqual({
      brandColour: '#0b5394',
      preset: 'rounded',
      hasLogo: false,
    });
    expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({ brandColour: '#0b5394' });

    const [version] = await versions(tenantA, 'platform.theme');
    expect(version).toMatchObject({
      version: 1,
      author_id: adminA.membershipId,
      diff: {
        changes: [
          { field: 'brandColour', from: '#1b1d21', to: '#0b5394' },
          { field: 'preset', from: 'standard', to: 'rounded' },
        ],
      },
    });
    const [event] = await events(tenantA, 'platform.theme.changed');
    expect(event).toMatchObject({
      actor_id: adminA.membershipId,
      entity_id: version?.entity_id,
      changes: {
        'app.tenant_theme.brand_colour': { before: '#1b1d21', after: '#0b5394' },
        'app.tenant_theme.preset': { before: 'standard', after: 'rounded' },
      },
    });

    await ok(call(adminA, 'PUT', '/theme', { brandColour: '#0b5394', preset: 'rounded' }));
    expect(await versions(tenantA, 'platform.theme')).toHaveLength(1);
  });

  it('keeps tenants’ themes apart', async () => {
    expect(await ok(call(adminB, 'GET', '/theme'))).toMatchObject({ brandColour: '#1b1d21' });
    await ok(call(adminB, 'PUT', '/theme', { brandColour: '#7a1f1f', preset: 'square' }));

    expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({ brandColour: '#0b5394' });
    expect(await versions(tenantB, 'platform.theme')).toHaveLength(1);
  });
});

describe('the module switch', () => {
  it('lists the switchable modules, on unless switched off', async () => {
    expect(await ok(call(adminA, 'GET', '/modules'))).toEqual({
      modules: [{ module: 'grants', enabled: true }],
    });
  });

  it('switches grants off and on, with a version and an audit event each time', async () => {
    expect((await grants(adminA)).statusCode).toBe(200);

    expect(
      await ok(call(adminA, 'PATCH', '/modules', { module: 'grants', enabled: false })),
    ).toEqual({
      modules: [{ module: 'grants', enabled: false }],
    });
    expect(await ok(call(adminA, 'GET', '/modules'))).toEqual({
      modules: [{ module: 'grants', enabled: false }],
    });
    expect((await grants(adminA)).statusCode).toBe(404);
    // The settings stay reachable, so a tenant can switch it back on.
    expect((await call(adminA, 'GET', '')).statusCode).toBe(200);

    await ok(call(adminA, 'PATCH', '/modules', { module: 'grants', enabled: true }));
    expect((await grants(adminA)).statusCode).toBe(200);

    const all = await versions(tenantA, 'platform.module');
    expect(all.map((row) => [row.version, row.author_id, row.diff.changes])).toEqual([
      [1, adminA.membershipId, [{ field: 'enabled', from: true, to: false }]],
      [2, adminA.membershipId, [{ field: 'enabled', from: false, to: true }]],
    ]);
    const [off] = await events(tenantA, 'platform.module.switched_off');
    expect(off).toMatchObject({
      actor_id: adminA.membershipId,
      entity_id: all[0]?.entity_id,
      changes: {
        'app.tenant_module.module': { after: 'grants' },
        'app.tenant_module.enabled': { before: true, after: false },
      },
    });
    expect(await events(tenantA, 'platform.module.switched_on')).toHaveLength(1);
  });

  it('writes nothing for a switch to the state it is in', async () => {
    await ok(call(adminA, 'PATCH', '/modules', { module: 'grants', enabled: true }));

    expect(await versions(tenantA, 'platform.module')).toHaveLength(2);
  });

  it('refuses a module that cannot be switched, and extra keys', async () => {
    for (const module of ['platform', 'party', 'nonsense']) {
      const response = await call(adminA, 'PATCH', '/modules', { module, enabled: false });
      expect(response.statusCode, module).toBe(400);
    }
    const extra = await call(adminA, 'PATCH', '/modules', {
      module: 'grants',
      enabled: false,
      tenantId: tenantB.id,
    });
    expect(extra.statusCode).toBe(400);
  });

  it('switches only the caller’s own tenant', async () => {
    await ok(call(adminB, 'PATCH', '/modules', { module: 'grants', enabled: false }));

    expect((await grants(adminB)).statusCode).toBe(404);
    expect((await grants(adminA)).statusCode).toBe(200);
    expect(await ok(call(adminA, 'GET', '/modules'))).toEqual({
      modules: [{ module: 'grants', enabled: true }],
    });
  });
});

describe('configuration versions', () => {
  const diff = [{ field: 'name' as const, from: 'a', to: 'b' }];

  it('fail cleanly when two requests write the same version', async () => {
    const tenant = tenantId(tenantA.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstWrote!: () => void;
    const written = new Promise<void>((resolve) => {
      firstWrote = resolve;
    });
    const entity = randomUUID();

    const first = app.database.inTenant(tenant, async (tx) => {
      await recordConfigVersion(tx, adminA.membershipId, 'platform.tenant', entity, diff);
      firstWrote();
      await gate;
    });
    await written;
    const second = app.database.inTenant(tenant, (tx) =>
      recordConfigVersion(tx, adminA.membershipId, 'platform.tenant', entity, diff),
    );
    const outcome = second.then(
      () => undefined,
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await first;

    const error = await outcome;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409 });
    const stored = (await versions(tenantA, 'platform.tenant')).filter(
      (row) => row.entity_id === entity,
    );
    expect(stored.map((row) => row.version)).toEqual([1]);
  });

  it('refuse a diff that does not fit the entity type', async () => {
    const bad = [{ field: 'brandColour', from: 'red', to: 'blue' }] as never;

    await expect(
      app.database.inTenant(tenantId(tenantA.id), (tx) =>
        recordConfigVersion(tx, adminA.membershipId, 'platform.theme', randomUUID(), bad),
      ),
    ).rejects.toThrow();
  });
});
