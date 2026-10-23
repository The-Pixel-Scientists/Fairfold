// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Loads a warehouse snapshot into a fresh PostgreSQL 16 with `psql`, as a data
// person does, and answers a query over it. The server is a throwaway
// container with no network that is removed afterwards, made from the image
// the stack already uses (TPS_E2E_POSTGRES_IMAGE overrides it); nothing is
// downloaded, and nothing that is running is touched.

import { execFile } from 'node:child_process';

const IMAGE = process.env['TPS_E2E_POSTGRES_IMAGE'] ?? 'postgres:16.15-bookworm';

function run(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { maxBuffer: 64 * 1024 * 1024 }, (error, out, err) => {
      if (error) reject(new Error(`docker ${args[0] ?? ''} failed: ${err || error.message}`));
      else resolve(out);
    });
    child.stdin?.end(input);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `psql` in a fresh server: loads the script with ON_ERROR_STOP, then returns the rows of the query, tab-separated. */
export async function loadAndQuery(script: string, query: string): Promise<string> {
  const id = (
    await run([
      'run',
      '--detach',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      IMAGE,
    ])
  ).trim();
  try {
    // The image starts a temporary server to set itself up, then restarts; only the last listens on TCP.
    for (let tries = 0; ; tries++) {
      try {
        await run(['exec', id, 'pg_isready', '--host', '127.0.0.1', '--quiet']);
        break;
      } catch (error) {
        if (tries > 60) throw error;
        await sleep(1000);
      }
    }
    await run(
      [
        'exec',
        '--interactive',
        id,
        'psql',
        '--username',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '--quiet',
        '--file',
        '-',
      ],
      script,
    );
    return await run([
      'exec',
      id,
      'psql',
      '--username',
      'postgres',
      '--no-align',
      '--tuples-only',
      '--field-separator',
      '\t',
      '--command',
      query,
    ]);
  } finally {
    await run(['rm', '--force', id]).catch(() => undefined);
  }
}
