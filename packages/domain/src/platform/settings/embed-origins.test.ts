// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { checkRoute } from '../../api/route.ts';
import { platformAuditActions } from '../audit.ts';
import { configDiffSchemas, configEntityTypes } from './config.ts';
import * as embed from './embed-origins.ts';

const {
  embedOriginInputSchema,
  embedOriginListSchema,
  embedOriginRoutes,
  embedOriginSchema,
  MAX_EMBED_ORIGINS,
  publicEmbedOriginRoutes,
  publicEmbedOriginsSchema,
} = embed;

const ID = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const row = { id: ID, origin: 'https://www.example.org', createdAt: '2026-12-03T09:00:00.000Z' };

describe('embedOriginSchema', () => {
  it('accepts an https origin with a DNS name and an optional port, lower-casing it', () => {
    for (const origin of [
      'https://example.org',
      'https://www.example.org',
      'https://grants.example.co.uk:8443',
      'https://xn--bcher-kva.example',
      'https://a-b.example.org:1',
      'https://a.example.org:65535',
    ]) {
      expect(embedOriginSchema.parse(origin), origin).toBe(origin);
    }
    expect(embedOriginSchema.parse(' HTTPS://WWW.Example.ORG ')).toBe('https://www.example.org');
  });

  it('refuses any other form', () => {
    for (const origin of [
      '',
      'http://www.example.org',
      'ftp://www.example.org',
      '//www.example.org',
      'www.example.org',
      'https://www.example.org/',
      'https://www.example.org/forms',
      'https://www.example.org?a=1',
      'https://www.example.org#top',
      'https://user@www.example.org',
      'https://user:pass@www.example.org',
      'https://*.example.org',
      'https://*',
      '*',
      "'self'",
      'https://www.example.org https://evil.example',
      'https://www.example.org;script-src *',
      'https://127.0.0.1',
      'https://10.0.0.1:8443',
      'https://[::1]',
      'https://[2001:db8::1]:443',
      'https://localhost',
      'https://example',
      'https://-a.example.org',
      'https://a-.example.org',
      'https://a..example.org',
      'https://.example.org',
      'https://example.org.',
      'https://bücher.example',
      'https://www.example.org:0',
      'https://www.example.org:08443',
      'https://www.example.org:65536',
      'https://www.example.org:',
      `https://${'a'.repeat(64)}.example.org`,
      `https://${'a.'.repeat(130)}org`,
    ]) {
      expect(embedOriginSchema.safeParse(origin).success, origin).toBe(false);
    }
  });

  it('matches the pattern the table check repeats, after lower-casing', () => {
    expect(embed.embedOriginPattern.test('https://www.example.org:8443')).toBe(true);
    expect(embed.embedOriginPattern.test('https://WWW.example.org')).toBe(false);
  });
});

describe('embed origin schemas', () => {
  it('are strict', () => {
    expect(embedOriginInputSchema.safeParse({ origin: row.origin, tenantId: ID }).success).toBe(
      false,
    );
    expect(embedOriginListSchema.safeParse({ origins: [{ ...row, createdBy: ID }] }).success).toBe(
      false,
    );
    expect(
      publicEmbedOriginsSchema.safeParse({ origins: [row.origin], tenantId: ID }).success,
    ).toBe(false);
  });

  it('hold at most 20 origins, and the public answer holds origins only', () => {
    const origins = Array.from({ length: MAX_EMBED_ORIGINS + 1 }, (_, i) => `https://s${i}.org.uk`);
    expect(publicEmbedOriginsSchema.safeParse({ origins: origins.slice(0, 20) }).success).toBe(
      true,
    );
    expect(publicEmbedOriginsSchema.safeParse({ origins }).success).toBe(false);
    expect(publicEmbedOriginsSchema.safeParse({ origins: [row] }).success).toBe(false);
    expect(
      embedOriginListSchema.safeParse({ origins: Array.from({ length: 21 }, () => row) }).success,
    ).toBe(false);
  });
});

describe('embed origin routes', () => {
  const consoleRoutes = Object.values(embedOriginRoutes);
  const publicRoutes = Object.values(publicEmbedOriginRoutes);

  it('keep every route rule, and are all listed', () => {
    for (const route of [...consoleRoutes, ...publicRoutes]) {
      expect(checkRoute(route), route.path).toEqual([]);
    }
    const exported = Object.values(embed).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set([...consoleRoutes, ...publicRoutes]));
  });

  it('need the settings permission over the whole tenant in the console, and adding is idempotent', () => {
    for (const route of consoleRoutes) {
      expect(route).toMatchObject({
        audience: 'console',
        module: 'platform',
        permission: 'platform.settings.manage',
        scope: 'tenant',
      });
    }
    expect(embed.addEmbedOrigin).toMatchObject({ method: 'POST', idempotent: true });
    expect(embed.removeEmbedOrigin.path).toBe('/console/settings/embed-origins/:originId');
  });

  it('read the public list by slug alone, with no session', () => {
    expect(embed.getPublicEmbedOrigins).toMatchObject({
      audience: 'public',
      permission: null,
      scope: null,
      method: 'GET',
      path: '/public/tenants/:slug/embed-origins',
    });
    expect(embed.getPublicEmbedOrigins).not.toHaveProperty('query');
    expect(embed.getPublicEmbedOrigins.responses[200]).toBe(publicEmbedOriginsSchema);
  });
});

describe('embed origin changes', () => {
  it('are a config entity type whose diff adds or removes one origin', () => {
    expect(configEntityTypes).toContain('platform.embed_origins');
    const diff = configDiffSchemas['platform.embed_origins'];
    expect(diff.parse([{ field: 'origin', from: 'https://a.example.org', to: null }])).toEqual([
      { field: 'origin', from: 'https://a.example.org', to: null },
    ]);
  });

  it('are audited as added and removed', () => {
    expect(platformAuditActions).toEqual(
      expect.arrayContaining(['platform.embed_origin.added', 'platform.embed_origin.removed']),
    );
  });
});

afterEach(() => {
  z.config({ jitless: true });
});

it('loads with zod running without eval', async () => {
  z.config({ jitless: false });
  vi.resetModules();
  await import('./index.ts');
  expect(z.config().jitless).toBe(true);
});
