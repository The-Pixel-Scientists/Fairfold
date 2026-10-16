// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starts main.ts as a process against the test database, with real settings,
// and calls it over HTTP: the probes, an auth route, and a clean shutdown.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { smtpTestSettings } from './support.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const CONSOLE_HOST = 'console.localhost';

let child: ChildProcess;
let port: number;
let output = '';
const authSecret = randomBytes(32).toString('hex');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const free = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(free);
      });
    });
  });
}

function get(url: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: url, headers: { host } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    })
      .on('error', reject)
      .end();
  });
}

async function untilReady(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The API exited early:\n${output}`);
    try {
      if ((await get('/health/ready', '127.0.0.1')).status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The API did not become ready:\n${output}`);
}

beforeAll(async () => {
  port = await freePort();
  const settings = {
    TPS_DEV: '1',
    TPS_API_PORT: String(port),
    TPS_DB_HOST: process.env['TPS_DB_HOST'],
    TPS_DB_PORT: process.env['TPS_DB_PORT'],
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
    TPS_DB_APP_API_PASSWORD: process.env['TPS_DB_APP_API_PASSWORD'],
    TPS_DB_APP_AUTH_PASSWORD: process.env['TPS_DB_APP_AUTH_PASSWORD'],
    TPS_AUTH_SECRET: authSecret,
    TPS_CONSOLE_ORIGIN: `http://${CONSOLE_HOST}:${String(port)}`,
    TPS_PORTAL_ORIGIN: `http://portal.localhost:${String(port)}`,
    ...smtpTestSettings,
  };
  child = spawn(process.execPath, [MAIN], {
    env: {
      PATH: process.env['PATH'] ?? '',
      SystemRoot: process.env['SystemRoot'] ?? '',
      ...settings,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  await untilReady();
}, 60_000);

afterAll(() => {
  child.kill();
});

describe('the running API', () => {
  it('answers the liveness probe', async () => {
    const response = await get('/health', '127.0.0.1');

    expect(response.status).toBe(200);
  });

  it('serves an auth route for a configured host, and answers a signed-out caller with 401', async () => {
    const response = await get('/api/auth/session', `${CONSOLE_HOST}:${String(port)}`);

    expect(response.status).toBe(401);
    expect(response.body).not.toContain(' at ');
  });

  it('answers 404 for a host that is not configured', async () => {
    const response = await get('/api/auth/session', 'unknown.example.org');

    expect(response.status).toBe(404);
  });

  it('keeps secrets out of its output', () => {
    expect(output).not.toContain(process.env['TPS_DB_APP_AUTH_PASSWORD'] ?? 'unset');
    expect(output).not.toContain(process.env['TPS_DB_APP_API_PASSWORD'] ?? 'unset');
    expect(output).not.toContain(authSecret);
  });

  // On Windows kill() is a forced termination, so no shutdown code runs.
  it.skipIf(process.platform === 'win32')(
    'stops cleanly on SIGTERM: exit status 0 and a Stopped line',
    async () => {
      const exited = new Promise<number | null>((resolve) => {
        child.once('close', (code) => {
          resolve(code);
        });
      });

      child.kill('SIGTERM');

      expect(await exited).toBe(0);
      expect(output).toContain('Stopped');
    },
  );
});
