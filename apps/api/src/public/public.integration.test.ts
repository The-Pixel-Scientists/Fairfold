// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The public tenant routes through the whole API against the test database,
// as app_api, with no session: what the portal reads before anyone signs in.

import { createHash } from 'node:crypto';

import { createDatabase, type Kysely } from '@pixel-scientists/db';
import { defaultTheme, defaultTokens, type TokenSet } from '@pixel-scientists/domain/platform';
import { themeCss } from '@pixel-scientists/domain/platform/settings';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  testSlug,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { expectLooksMissing, smtpTestSettings } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { openDatabase, publicTenantsOn, type ApiDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { composeModules } from '../modules.ts';

let api: FastifyInstance;
let database: ApiDatabase;
let recording: Kysely<unknown>;
/** Every statement the public routes sent, as the connection saw it. */
const statements: string[] = [];

let plain: TestTenant;
let themed: TestTenant;
let suspended: TestTenant;
let invalid: TestTenant;
let tokened: TestTenant;
let stale: TestTenant;
/** The codes the public routes logged. */
const logged: string[] = [];

const ownTokens: TokenSet = {
  ...defaultTokens,
  radii: { radiusSm: 0.5, radiusMd: 0.75, radiusLg: 1 },
  font: 'system',
};
// Saved under an older rule: ink as pale as the canvas.
const failingTokens: TokenSet = {
  ...ownTokens,
  light: { ...ownTokens.light, colorInk: '#f7f7f5' },
};

const LOGO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from('IHDR', 'ascii'),
  Buffer.from([0, 0, 0, 40, 0, 0, 0, 20, 8, 6, 0, 0, 0, 0, 0, 0, 0]),
]);

async function addTheme(tenant: TestTenant, theme: Record<string, unknown>): Promise<void> {
  await asMigratorIn(tenant.id, async (client) => {
    const updatedBy = await addMember(client, tenant);
    await insertRow(client, 'app.tenant_theme', {
      tenant_id: tenant.id,
      updated_by: updatedBy,
      ...theme,
    });
  });
}

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41004',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));

  [plain, themed, suspended, invalid, tokened, stale] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
  await Promise.all([
    addTheme(themed, {
      brand_colour: '#0b5394',
      preset: 'rounded',
      logo: LOGO,
      logo_type: 'image/png',
    }),
    addTheme(suspended, {
      brand_colour: '#0b5394',
      preset: 'square',
      logo: LOGO,
      logo_type: 'image/png',
    }),
    // Stored by a writer that skipped the contrast check: it must not reach the stylesheet.
    addTheme(invalid, { brand_colour: '#ffffff', preset: 'standard' }),
    addTheme(tokened, { brand_colour: '#0b5394', preset: 'rounded', tokens: ownTokens }),
    addTheme(stale, { brand_colour: '#0b5394', preset: 'rounded', tokens: failingTokens }),
  ]);
  await asMigratorIn(suspended.id, (client) =>
    client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]),
  );

  // The same functions as the API's, on a connection that records what it sends.
  recording = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    role: 'app_api',
    password: settings.password.reveal(),
    applicationName: 'tps-public-test',
    tls: settings.tls,
  }).withPlugin({
    transformQuery: ({ node }) => {
      statements.push(JSON.stringify(node));
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  });

  api = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    ...composeModules({
      publicTenants: publicTenantsOn(recording),
      log: { warn: ({ code }) => logged.push(code) },
    }),
  });
}, 60_000);

afterAll(async () => {
  // The migrations test rolls migration 0014 back, which refuses while any committed theme has tokens.
  for (const tenant of [tokened, stale]) {
    await asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE app.tenant_theme SET tokens = NULL'),
    );
  }
  await api.close();
  await database.close();
  await recording.destroy();
});

const get = (path: string) => api.inject({ url: `/api/public/tenants/${path}` });

describe('a tenant’s name and theme', () => {
  it('shows the name and default look of a tenant with no theme', async () => {
    const response = await get(plain.slug);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'Test tenant',
      theme: { brandColour: defaultTheme.brandColour, preset: 'standard', hasLogo: false },
    });
  });

  it('shows a themed tenant’s tokens and whether it has a logo, and nothing else', async () => {
    const response = await get(themed.slug);

    expect(response.json()).toEqual({
      name: 'Test tenant',
      theme: { brandColour: '#0b5394', preset: 'rounded', hasLogo: true },
    });
    expect(response.body).not.toContain(themed.id);
    expect(response.headers['content-type']).toContain('application/json');
  });
});

describe('the stylesheet', () => {
  it('is built from the validated tokens, as text/css', async () => {
    const response = await get(`${themed.slug}/theme.css`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toBe(themeCss({ brandColour: '#0b5394', preset: 'rounded' }));
  });

  it('holds only custom properties with colour and size values, and no tenant text', async () => {
    const name = 'Test tenant';
    const css = (await get(`${themed.slug}/theme.css`)).body;

    expect(css).not.toContain(name);
    expect(css).not.toContain(themed.slug);
    const declaration = /^ {2}--[a-z-]+: (?:#[0-9a-f]{6}|[0-9.]+rem|0);$/;
    const lines = css.split('\n').filter((line) => line.startsWith(' '));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => declaration.test(line))).toBe(true);
  });

  it('falls back to the default look for a stored colour that fails contrast', async () => {
    const response = await get(`${invalid.slug}/theme.css`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(themeCss(defaultTheme));
    expect(response.body).not.toContain('--color-accent: #ffffff');
  });
});

describe('the stylesheet of a tenant with its own tokens', () => {
  it('is built from them in place of the preset, with only formatted values', async () => {
    const response = await get(`${tokened.slug}/theme.css`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(themeCss({ tokens: ownTokens }));
    expect(response.body).not.toBe(themeCss({ brandColour: '#0b5394', preset: 'rounded' }));
    const declaration = /^ {2}--[a-z0-9-]+: (?:#[0-9a-f]{6}|[0-9.]+rem|0|[-'A-Za-z, ]{10,});$/;
    const lines = response.body.split('\n').filter((line) => line.startsWith(' '));
    expect(lines.length).toBeGreaterThan(50);
    expect(
      lines.every((line) => declaration.test(line)),
      lines.join('\n'),
    ).toBe(true);
    expect(logged).toEqual([]);
  });

  it('serves the preset look, and logs a code, when stored tokens no longer pass', async () => {
    const response = await get(`${stale.slug}/theme.css`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(themeCss({ brandColour: '#0b5394', preset: 'rounded' }));
    expect(response.body).not.toContain('#f7f7f5;\n  --color-ink');
    expect(logged).toEqual(['theme_tokens_invalid']);
  });

  it('does not put its tokens in the public tenant answer', async () => {
    const response = await get(tokened.slug);

    expect(response.json()).toEqual({
      name: 'Test tenant',
      theme: { brandColour: '#0b5394', preset: 'rounded', hasLogo: false },
    });
  });
});

describe('the logo', () => {
  it('is served as its checked type, shown inline and never sniffed', async () => {
    const response = await get(`${themed.slug}/logo`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe('inline');
    expect(createHash('sha256').update(response.rawPayload).digest('hex')).toBe(
      createHash('sha256').update(LOGO).digest('hex'),
    );
  });
});

describe('a tenant that cannot be shown', () => {
  const unknown = testSlug();

  it.each([
    ['', 'theme'],
    ['/theme.css', 'stylesheet'],
    ['/logo', 'logo'],
  ])('answers the same 404 for a suspended, unknown and malformed slug: %s', async (suffix) => {
    const missing = await get(`${unknown}${suffix}`);
    expect(missing.statusCode).toBe(404);

    for (const slug of [suspended.slug, plain.slug, 'A', 'x', 'bad_slug', unknown.toUpperCase()]) {
      // A tenant with no logo, or a suspended one, reads as an unknown one.
      if (slug === plain.slug && suffix !== '/logo') continue;
      expectLooksMissing(await get(`${slug}${suffix}`), missing);
    }
  });

  it('leaks nothing of a suspended tenant', async () => {
    for (const suffix of ['', '/theme.css', '/logo']) {
      const response = await get(`${suspended.slug}${suffix}`);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('Test tenant');
      expect(response.body).not.toContain('#0b5394');
    }
  });

  it('does not take a path that names a tenant any other way', async () => {
    for (const path of [`%27%20OR%20true`, `${themed.slug}%00`]) {
      const response = await get(path);
      expect([400, 404]).toContain(response.statusCode);
      expect(response.body).not.toContain('"theme"');
    }
  });
});

describe('the connection', () => {
  it('has no tenant set for any public request, and runs one statement for each', async () => {
    statements.length = 0;
    await get(themed.slug);
    await get(`${themed.slug}/theme.css`);
    await get(`${themed.slug}/logo`);
    await get(suspended.slug);

    expect(statements).toHaveLength(4);
    for (const statement of statements) {
      expect(statement).toMatch(/app\.public_tenant(?:_logo)?\(/);
      expect(statement).not.toMatch(/set_config|current_setting|app\.tenant_id|BEGIN|SET /i);
    }
  });
});
