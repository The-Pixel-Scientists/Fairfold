// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { format, resolveConfig } from 'prettier';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.ts';
import { createLogger } from './logger.ts';

// Building the application loads Fastify and its plugins, which is slow on a cold start.
vi.setConfig({ testTimeout: 15_000 });

const COMMITTED = fileURLToPath(new URL('../openapi.json', import.meta.url));

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function startApp(): Promise<FastifyInstance> {
  app = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => Promise.resolve(),
  });
  return app;
}

/** The document as the repository formats JSON, so the committed file passes `pnpm format:check`. */
async function formatted(json: string): Promise<string> {
  const options = await resolveConfig(COMMITTED);
  return format(json, { ...options, filepath: COMMITTED });
}

describe('GET /openapi.json', () => {
  it('serves an OpenAPI 3.1 document built from the route schemas', async () => {
    const server = await startApp();
    const response = await server.inject({ url: '/openapi.json' });
    const document = response.json<{
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, Record<string, unknown>>;
    }>();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('PixelGrant API');
    expect(Object.keys(document.paths).sort()).toEqual(['/health', '/health/ready']);
    expect(Object.keys(document.paths['/health/ready'] ?? {})).toEqual(['get']);
  });

  it('matches apps/api/openapi.json, so a change to the API shows in review', async () => {
    const server = await startApp();
    const response = await server.inject({ url: '/openapi.json' });

    // To accept an intended change, run `pnpm test:unit -- apps/api -u` and commit the new file.
    await expect(await formatted(response.body)).toMatchFileSnapshot(COMMITTED);
  });
});
