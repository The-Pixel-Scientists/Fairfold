// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The routes that save and remove a funder's own design tokens, through the
// whole API against the test database as app_api: permissions, refusals by
// token path, configuration versions, audit events and two tenants.

import { defaultTokens, tokenPaths, type TokenSet } from '@pixel-scientists/domain/platform';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import {
  addMember,
  events,
  ok,
  startSettingsApi,
  versions,
  type Member,
  type SettingsApi,
} from '../../../test/settings-api.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let app: SettingsApi;
let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let adminB: Member;
let managerA: Member;
let reviewerA: Member;
let applicantA: Member;

beforeAll(async () => {
  app = await startSettingsApi('41006');
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  managerA = await addMember(tenantA, 'console', 'programme_manager');
  reviewerA = await addMember(tenantA, 'console', 'reviewer');
  applicantA = await addMember(tenantA, 'portal', 'applicant');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await app.close();
  // The migrations test rolls migration 0014 back, which refuses while any committed theme has tokens.
  for (const tenant of [tenantA, tenantB]) await clearTokens(tenant);
});

const call = (...args: Parameters<SettingsApi['call']>) => app.call(...args);

/** A look that passes every check: the default, with rounder corners and the device's font. */
const rounder: TokenSet = {
  ...defaultTokens,
  radii: { radiusSm: 0.5, radiusMd: 0.75, radiusLg: 1 },
  font: 'system',
};

const save = (member: Member, tokens: unknown) => call(member, 'PUT', '/theme/tokens', { tokens });

const refusals = (response: LightMyRequestResponse) => {
  expect(response.statusCode, response.body).toBe(400);
  return response.json<{ errors: { field: string; message: string }[] }>().errors;
};

const clearTokens = (tenant: TestTenant) =>
  asMigratorIn(tenant.id, (client) => client.query('UPDATE app.tenant_theme SET tokens = NULL'));

const storedTokens = (tenant: TestTenant) =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{ tokens: unknown }>('SELECT tokens FROM app.tenant_theme');
    return rows.map((row) => row.tokens);
  });

describe('who may save or remove tokens', () => {
  it('refuses every role but the administrator, a portal session and a signed-out caller', async () => {
    for (const [method, payload] of [
      ['PUT', { tokens: rounder }],
      ['DELETE', undefined],
    ] as const) {
      for (const member of [managerA, reviewerA, applicantA]) {
        const response = await call(member, method, '/theme/tokens', payload);
        expect(response.statusCode, `${method} as ${member.membershipId}`).toBe(403);
      }
      expect((await call(undefined, method, '/theme/tokens', payload)).statusCode).toBe(401);
    }
    expect(await versions(tenantA, 'platform.theme')).toEqual([]);
    expect(await events(tenantA, 'platform.theme.changed')).toEqual([]);
  });
});

describe('refusals', () => {
  it('name a failing pair by its token, in the catalogue words', async () => {
    const pale = { ...rounder, light: { ...rounder.light, colorInk: '#eeeeee' } };

    const errors = refusals(await save(adminA, pale));

    expect(errors).toContainEqual({
      field: 'body.tokens.light.colorInk',
      message: expect.stringMatching(
        /^In the light scheme, ink on canvas is \d+(\.\d)?:1\. It needs at least 4\.5:1\.$/,
      ) as string,
    });
    expect(errors.every((error) => error.field === 'body.tokens.light.colorInk')).toBe(true);
    expect(errors.length).toBeGreaterThan(1);
  });

  it('name every failing token, not the first', async () => {
    const pale = {
      ...rounder,
      light: { ...rounder.light, colorInk: '#eeeeee' },
      dark: { ...rounder.dark, colorInk: '#111111' },
    };

    const fields = new Set(refusals(await save(adminA, pale)).map((error) => error.field));

    expect(fields).toEqual(new Set(['body.tokens.light.colorInk', 'body.tokens.dark.colorInk']));
  });

  it('refuse hostile values, wrong types, unknown keys and a broken order, storing nothing', async () => {
    const proto: object = JSON.parse('{"__proto__":{"polluted":true}}') as object;
    const bad: unknown[] = [
      { ...rounder, light: { ...rounder.light, colorAccent: 'red; } body { display: none' } },
      { ...rounder, light: { ...rounder.light, colorAccent: 'url(https://example.test/x)' } },
      { ...rounder, light: { ...rounder.light, colorAccent: '#12345' } },
      { ...rounder, font: "Comic Sans'; } body { color: red" },
      { ...rounder, radii: { ...rounder.radii, radiusSm: '1rem' } },
      { ...rounder, radii: { ...rounder.radii, radiusSm: -1 } },
      { ...rounder, radii: { ...rounder.radii, radiusMd: 99 } },
      { ...rounder, radii: { radiusSm: 1, radiusMd: 0.5, radiusLg: 0.25 } },
      { ...rounder, type: { ...rounder.type, textBase: 0.5 } },
      { ...rounder, extra: 'x' },
      { ...rounder, light: { ...rounder.light, colorEvil: '#000000' } },
      { ...rounder, ...proto },
      { ...rounder, light: undefined },
      'tokens',
      null,
    ];
    for (const tokens of bad) {
      const response = await save(adminA, tokens);
      expect(response.statusCode, JSON.stringify(tokens)).toBe(400);
      expect(response.body).not.toContain('example.test');
      expect(response.body).not.toContain('Comic');
    }
    const extra = await call(adminA, 'PUT', '/theme/tokens', {
      tokens: rounder,
      tenantId: tenantB.id,
    });
    expect(extra.statusCode).toBe(400);

    expect(await versions(tenantA, 'platform.theme')).toEqual([]);
    expect(await events(tenantA, 'platform.theme.changed')).toEqual([]);
    expect(await storedTokens(tenantA)).toEqual([]);
  });
});

describe('saving tokens', () => {
  it('stores them, with a version diffed by token name and an audit event naming them', async () => {
    const saved = await ok<{ tokens: TokenSet }>(save(adminA, rounder));
    expect(saved.tokens).toEqual(rounder);
    expect(await ok(call(adminA, 'GET', '/theme'))).toEqual({
      brandColour: '#1b1d21',
      preset: 'standard',
      hasLogo: false,
      tokens: rounder,
    });

    const [version] = await versions(tenantA, 'platform.theme');
    expect(version).toMatchObject({ version: 1, author_id: adminA.membershipId });
    const changes = version?.diff.changes ?? [];
    expect(changes).toHaveLength(tokenPaths.length);
    expect(changes).toContainEqual({ field: 'token', token: 'font', from: null, to: 'system' });
    expect(changes).toContainEqual({ field: 'token', token: 'radii.radiusLg', from: null, to: 1 });
    expect(changes.every((change) => change.field === 'token')).toBe(true);

    const [event] = await events(tenantA, 'platform.theme.changed');
    expect(event).toMatchObject({ actor_id: adminA.membershipId, entity_id: version?.entity_id });
    expect(event?.changes['app.tenant_theme.tokens']).toMatchObject({
      after: { font: 'system', 'radii.radiusLg': 1 },
    });
  });

  it('records only the tokens that changed on the next save, and nothing for the same look', async () => {
    await ok(save(adminA, rounder));
    expect(await versions(tenantA, 'platform.theme')).toHaveLength(1);

    await ok(save(adminA, { ...rounder, font: 'atkinson' }));
    const all = await versions(tenantA, 'platform.theme');
    expect(all.map((row) => row.version)).toEqual([1, 2]);
    expect(all[1]?.diff.changes).toEqual([
      { field: 'token', token: 'font', from: 'system', to: 'atkinson' },
    ]);
    const [, second] = await events(tenantA, 'platform.theme.changed');
    expect(second?.changes['app.tenant_theme.tokens']).toEqual({
      before: { font: 'system' },
      after: { font: 'atkinson' },
    });
  });

  it('keeps the tokens when the logo changes', async () => {
    await ok(call(adminA, 'DELETE', '/theme/logo'));

    expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({ tokens: { font: 'atkinson' } });
  });
});

describe('going back to the preset', () => {
  it('clears the tokens when a preset or brand colour is saved, and the diff says so', async () => {
    const before = (await versions(tenantA, 'platform.theme')).length;

    const answered = await ok(
      call(adminA, 'PUT', '/theme', { brandColour: '#0b5394', preset: 'rounded' }),
    );

    expect(answered).toEqual({
      brandColour: '#0b5394',
      preset: 'rounded',
      hasLogo: false,
      tokens: null,
    });
    expect(await storedTokens(tenantA)).toEqual([null]);
    const all = await versions(tenantA, 'platform.theme');
    expect(all).toHaveLength(before + 1);
    const changes = all.at(-1)?.diff.changes ?? [];
    expect(changes.filter((change) => change.field === 'token')).toHaveLength(tokenPaths.length);
    expect(changes).toContainEqual({ field: 'token', token: 'font', from: 'atkinson', to: null });
    expect(changes).toContainEqual({ field: 'brandColour', from: '#1b1d21', to: '#0b5394' });
  });

  it('clears the tokens even when the preset and colour are unchanged', async () => {
    await ok(save(adminA, rounder));

    await ok(call(adminA, 'PUT', '/theme', { brandColour: '#0b5394', preset: 'rounded' }));

    expect(await storedTokens(tenantA)).toEqual([null]);
  });

  it('removes the tokens on request, with a version and an audit event', async () => {
    await ok(save(adminA, rounder));
    const before = (await versions(tenantA, 'platform.theme')).length;
    const eventsBefore = (await events(tenantA, 'platform.theme.changed')).length;

    const answered = await ok<{ tokens: unknown }>(call(adminA, 'DELETE', '/theme/tokens'));

    expect(answered.tokens).toBeNull();
    expect(await storedTokens(tenantA)).toEqual([null]);
    const all = await versions(tenantA, 'platform.theme');
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)?.diff.changes.every((change) => change.field === 'token')).toBe(true);
    expect(await events(tenantA, 'platform.theme.changed')).toHaveLength(eventsBefore + 1);
  });

  it('writes nothing when there are no tokens to remove', async () => {
    const before = (await versions(tenantA, 'platform.theme')).length;

    await ok(call(adminA, 'DELETE', '/theme/tokens'));

    expect(await versions(tenantA, 'platform.theme')).toHaveLength(before);
  });

  describe('stored tokens that no longer pass', () => {
    const stale = { ...rounder, light: { ...rounder.light, colorInk: '#eeeeee' } };
    let eventsBefore: number;

    beforeEach(async () => {
      await asMigratorIn(tenantA.id, (client) =>
        client.query('UPDATE app.tenant_theme SET tokens = $1', [JSON.stringify(stale)]),
      );
      eventsBefore = (await events(tenantA, 'platform.theme.changed')).length;
    });

    async function expectClearedEvent() {
      expect(await storedTokens(tenantA)).toEqual([null]);
      const written = (await events(tenantA, 'platform.theme.changed')).slice(eventsBefore);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ actor_id: adminA.membershipId });
      expect(written[0]?.changes['app.tenant_theme.tokens']).toEqual({
        before: 'unusable',
        after: null,
      });
      expect(JSON.stringify(written[0]?.changes)).not.toContain('#eeeeee');
    }

    it('reads as none, and removal records an audit event with a marker', async () => {
      expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({ tokens: null });

      await ok(call(adminA, 'DELETE', '/theme/tokens'));

      await expectClearedEvent();
    });

    it('is not recorded, and the tokens stay, when the logo is removed', async () => {
      await ok(call(adminA, 'DELETE', '/theme/logo'));

      expect(await events(tenantA, 'platform.theme.changed')).toHaveLength(eventsBefore);
      expect(await storedTokens(tenantA)).toEqual([stale]);
    });

    it('is recorded when a save with an unchanged look clears them', async () => {
      await ok(call(adminA, 'PUT', '/theme', { brandColour: '#0b5394', preset: 'rounded' }));

      await expectClearedEvent();
    });
  });
});

describe('two tenants', () => {
  it('keeps each tenant tokens, versions and events apart', async () => {
    await ok(save(adminA, rounder));

    expect(await ok(call(adminB, 'GET', '/theme'))).toMatchObject({ tokens: null });
    expect(await versions(tenantB, 'platform.theme')).toEqual([]);

    await ok(save(adminB, { ...rounder, font: 'atkinson' }));
    await ok(call(adminB, 'DELETE', '/theme/tokens'));

    expect(await ok(call(adminA, 'GET', '/theme'))).toMatchObject({ tokens: { font: 'system' } });
    expect(await storedTokens(tenantA)).toEqual([rounder]);
    const own = await versions(tenantB, 'platform.theme');
    expect(own.every((row) => row.author_id === adminB.membershipId)).toBe(true);
    expect(
      (await events(tenantB, 'platform.theme.changed')).every(
        (event) => event.actor_id === adminB.membershipId,
      ),
    ).toBe(true);
  });
});
