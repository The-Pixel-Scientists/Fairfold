// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A fresh PostgreSQL 16 container for loading a warehouse script with psql,
// as a funder would. Docker must be running. The container has no network,
// keeps no data after the test, and each load gets a database of its own.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** The image the development stack pins (infra/compose/compose.stack.yaml). */
const IMAGE =
  'postgres:16.15-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67';

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function docker(args: string[], stdin?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin ?? '');
  });
}

async function dockerOk(args: string[], stdin?: string): Promise<string> {
  const result = await docker(args, stdin);
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

export interface FreshPostgres {
  /**
   * Loads `script` into a new database with `psql -v ON_ERROR_STOP=1 -f`, and returns that database's name.
   * `clientEncoding` sets PGCLIENTENCODING for psql, as a loader's locale would.
   */
  load(
    script: string,
    options?: { clientEncoding?: string },
  ): Promise<{ database: string; code: number | null; stderr: string }>;
  /** Runs one query in `database` and returns its rows as JSON. */
  json<T>(database: string, query: string): Promise<T>;
  stop(): Promise<void>;
}

export async function startFreshPostgres(): Promise<FreshPostgres> {
  const name = `tps-warehouse-test-${randomUUID()}`;
  await dockerOk([
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--network',
    'none',
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    IMAGE,
  ]);
  const psql = (database: string, args: string[], stdin?: string, clientEncoding?: string) =>
    docker(
      [
        'exec',
        '--interactive',
        ...(clientEncoding ? ['--env', `PGCLIENTENCODING=${clientEncoding}`] : []),
        name,
        'psql',
        '--username=postgres',
        `--dbname=${database}`,
        ...args,
      ],
      stdin,
    );

  try {
    // The image starts a server to run its set-up, stops it, and starts the real one.
    for (let attempt = 0; ; attempt++) {
      const logs = await docker(['logs', name]);
      const ready = `${logs.stdout}${logs.stderr}`.split('ready to accept connections').length > 2;
      if (ready && (await psql('postgres', ['--command=SELECT 1'])).code === 0) break;
      if (attempt > 120) throw new Error('The PostgreSQL container did not start.');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    await docker(['rm', '--force', name]);
    throw error;
  }

  return {
    async load(script, options) {
      const database = `load_${randomUUID().replaceAll('-', '')}`;
      const created = await psql('postgres', [`--command=CREATE DATABASE ${database}`]);
      if (created.code !== 0) throw new Error(created.stderr);
      const loaded = await psql(
        database,
        ['--no-psqlrc', '--quiet', '--variable=ON_ERROR_STOP=1', '--file=-'],
        script,
        options?.clientEncoding,
      );
      return { database, code: loaded.code, stderr: loaded.stderr };
    },
    async json<T>(database: string, query: string) {
      const result = await psql(database, [
        '--no-psqlrc',
        '--tuples-only',
        '--no-align',
        `--command=${query}`,
      ]);
      if (result.code !== 0) throw new Error(result.stderr);
      return JSON.parse(result.stdout) as T;
    },
    async stop() {
      await docker(['rm', '--force', name]);
    },
  };
}
