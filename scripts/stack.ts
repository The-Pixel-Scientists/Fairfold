// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm stack` (ADR 0005): build the release images, then run PostgreSQL,
// the migrations, the API, the console and the portal in containers, as a
// self-hosted install runs them (infra/compose/compose.stack.yaml).
//
//   node scripts/stack.ts                    build, start and wait until ready
//   node scripts/stack.ts down [--volumes]   stop; --volumes also deletes the
//                                            data and the secrets
//   node scripts/stack.ts <command...>       any other Compose command, such
//                                            as `logs api`
//
// Each worktree has its own Compose project and ports (dev-names.ts). Its
// secrets are random, made on the first start, and kept outside the checkout
// in ~/.tps/stack/<project>, one file each, readable by this user
// only. Compose copies each into only the containers that use it.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { currentDevNames, repositoryRoot } from './dev-names.ts';

/** The variables compose.stack.yaml reads its secrets from. The first is the superuser's. */
const SECRETS = [
  'TPS_STACK_POSTGRES_PASSWORD',
  'TPS_STACK_MIGRATOR_PASSWORD',
  'TPS_STACK_APP_API_PASSWORD',
  'TPS_STACK_APP_WORKER_PASSWORD',
  'TPS_STACK_APP_AUTH_PASSWORD',
  'TPS_STACK_APP_QUEUE_PASSWORD',
] as const;

const names = currentDevNames();
const project = names.stackProject;
const secretsFolder = join(homedir(), '.tps', 'stack', project);
const ports = {
  TPS_STACK_API_PORT: String(names.ports.stackApi),
  TPS_STACK_CONSOLE_PORT: String(names.ports.stackConsole),
  TPS_STACK_PORTAL_PORT: String(names.ports.stackPortal),
};

/**
 * Read the secrets, making any that are missing. A new superuser password
 * cannot open a database made with the old one, so that is refused.
 */
function loadSecrets(): Record<string, string> {
  mkdirSync(secretsFolder, { recursive: true, mode: 0o700 });
  const values: Record<string, string> = {};
  for (const name of SECRETS) {
    const path = join(secretsFolder, name);
    if (!existsSync(path)) {
      if (name === SECRETS[0] && volumeExists('postgres-data')) {
        throw new Error(
          `The stack's database was made with a superuser password that is no longer in ` +
            `${secretsFolder}. Delete the stack's data with: pnpm stack down --volumes`,
        );
      }
      writeFileSync(path, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
    }
    values[name] = readFileSync(path, 'utf8');
  }
  return values;
}

function volumeExists(volume: string): boolean {
  const result = spawnSync('docker', ['volume', 'inspect', `${project}_${volume}`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function compose(args: readonly string[], secrets: Record<string, string> = {}): number {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '--file',
      join(repositoryRoot, 'infra', 'compose', 'compose.stack.yaml'),
      ...args,
    ],
    { stdio: 'inherit', env: { ...process.env, ...ports, ...secrets } },
  );
  return result.status ?? 1;
}

async function up(): Promise<number> {
  const status = compose(
    ['up', '--build', '--detach', '--wait', 'api', 'console', 'portal'],
    loadSecrets(),
  );
  if (status !== 0) return status;

  const ready = `http://127.0.0.1:${ports.TPS_STACK_API_PORT}/health/ready`;
  const response = await fetch(ready);
  console.log(`${ready} answered ${String(response.status)}: ${await response.text()}`);
  console.log(`Console: http://console.localhost:${ports.TPS_STACK_CONSOLE_PORT}`);
  console.log(`Portal:  http://portal.localhost:${ports.TPS_STACK_PORTAL_PORT}`);
  console.log('Stop it with: pnpm stack down');
  return response.ok ? 0 : 1;
}

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 0) return up();
  const status = compose(args);
  if (
    status === 0 &&
    args[0] === 'down' &&
    args.some((arg) => arg === '--volumes' || arg === '-v')
  ) {
    rmSync(secretsFolder, { recursive: true, force: true });
  }
  return status;
}

try {
  process.exitCode = await main(process.argv.slice(2).filter((arg) => arg !== '--'));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
