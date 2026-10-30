// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The API describes its routes at /openapi.json, on its own port. Today it
// answers 500 once the modules' routes are registered: @fastify/swagger throws
// a TypeError while resolving one route's responses. The test is marked as
// expected to fail, so the suite stays green; it fails the day the document
// works, and the mark comes off then.

import { request } from '@playwright/test';

import { currentDevNames } from '../../scripts/dev-names.ts';
import { expect, test } from '../../scripts/e2e/fixtures.ts';

const { ports } = currentDevNames();

test.describe('the API’s description of itself', () => {
  test.skip(process.env['TPS_E2E_STACK'] !== '1', 'Runs against the stack: pnpm stack.');

  test('lists the console routes', async () => {
    test.fail(true, 'GET /openapi.json answers 500 once the modules’ routes are registered.');
    const api = await request.newContext({ baseURL: `http://127.0.0.1:${String(ports.stackApi)}` });
    const response = await api.get('/openapi.json');
    expect(response.status()).toBe(200);
    const { paths } = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(paths)).toContain('/console/programmes');
    await api.dispose();
  });
});
