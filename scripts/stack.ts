// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm stack` (ADR 0005): build the release images, then run PostgreSQL,
// the migrations, the API, the console, the portal and Mailpit in
// containers, as a self-hosted install runs them
// (infra/compose/compose.stack.yaml).
//
//   node scripts/stack.ts                    build, start and wait until ready
//   node scripts/stack.ts seed [arguments]   run the development seed against
//                                            the stack's database
//   node scripts/stack.ts down [--volumes]   stop; --volumes also deletes the
//                                            data and the secrets
//   node scripts/stack.ts <command...>       any other Compose command, such
//                                            as `logs api`
//
// Each worktree has its own Compose project and ports (dev-names.ts). Its
// secrets are random, made on the first start, and kept outside the checkout
// in ~/.tps/stack/<project>, one file each, readable by this user
// only. Compose copies each into only the containers that use it. The seed
// password stays in that folder; the seed reads it from there.
//
// The console and portal reach the API over a network of their own, `web`,
// which this script makes before Compose starts so that it can tell the API
// to trust the forwarding headers of that network's addresses only.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ensureSecretFile, withoutOurVariables } from './dev-env.ts';
import { currentDevNames, repositoryRoot } from './dev-names.ts';

/** The variables compose.stack.yaml reads its secrets from. The first is the superuser's. */
const SECRETS = [
  'TPS_STACK_POSTGRES_PASSWORD',
  'TPS_STACK_MIGRATOR_PASSWORD',
  'TPS_STACK_APP_API_PASSWORD',
  'TPS_STACK_APP_WORKER_PASSWORD',
  'TPS_STACK_APP_AUTH_PASSWORD',
  'TPS_STACK_APP_QUEUE_PASSWORD',
  'TPS_STACK_AUTH_SECRET',
] as const;

/** The database compose.stack.yaml migrates. */
const STACK_DATABASE = 'tps';

const SEED_SCRIPT = join(repositoryRoot, 'packages', 'db', 'seed', 'seed.ts');

/**
 * The environment for the seed against the stack: none of the caller's
 * TPS_ variables, the tunnel's port on this machine, the stack's
 * database as the only one it may fill, and migrator's password and the seed
 * password as files in the stack's secrets folder.
 */
export function seedEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  port: string,
  secrets: string,
): Record<string, string> {
  return {
    ...withoutOurVariables(inherited),
    TPS_DEV: '1',
    TPS_DB_HOST: '127.0.0.1',
    TPS_DB_PORT: port,
    TPS_DB_NAME: STACK_DATABASE,
    TPS_DEV_DATABASES: STACK_DATABASE,
    TPS_DB_MIGRATOR_PASSWORD_FILE: join(secrets, 'TPS_STACK_MIGRATOR_PASSWORD'),
    TPS_SEED_PASSWORD_FILE: join(secrets, 'TPS_STACK_SEED_PASSWORD'),
  };
}

/** The address Docker published a port on, as `docker compose port` prints it. */
export function publishedPort(output: string): string {
  const port = /^127\.0\.0\.1:([0-9]{1,5})$/.exec(output.trim())?.[1];
  if (port === undefined) throw new Error(`Docker published the tunnel at ${output.trim()}.`);
  return port;
}

const names = currentDevNames();
const project = names.stackProject;
const secretsFolder = join(homedir(), '.tps', 'stack', project);
const webNetwork = `${project}_web`;
const ports = {
  TPS_STACK_API_PORT: String(names.ports.stackApi),
  TPS_STACK_CONSOLE_PORT: String(names.ports.stackConsole),
  TPS_STACK_PORTAL_PORT: String(names.ports.stackPortal),
  TPS_STACK_MAIL_PORT: String(names.ports.stackMail),
};

/**
 * Read the secrets, making any that are missing. A new superuser password
 * cannot open a database made with the old one, so that is refused.
 */
function loadSecrets(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of SECRETS) {
    const path = join(secretsFolder, name);
    if (name === SECRETS[0] && !existsSync(path) && volumeExists('postgres-data')) {
      throw new Error(
        `The stack's database was made with a superuser password that is no longer in ` +
          `${secretsFolder}. Delete the stack's data with: pnpm stack down --volumes`,
      );
    }
    ensureSecretFile(path);
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

/** The address ranges of the `web` network, comma-separated, or '' if it does not exist. */
function webSubnets(): string {
  const result = spawnSync(
    'docker',
    ['network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Subnet}} {{end}}', webNetwork],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return result.status === 0 ? result.stdout.trim().split(/\s+/).join(',') : '';
}

/** Make the `web` network, with no way out, unless it is there. */
function createWebNetwork(): void {
  if (webSubnets() !== '') return;
  const result = spawnSync('docker', ['network', 'create', '--internal', webNetwork], {
    stdio: 'ignore',
  });
  if (result.status !== 0) throw new Error(`Could not create the Docker network ${webNetwork}.`);
}

function compose(
  args: readonly string[],
  options: { secrets?: Record<string, string>; capture?: boolean } = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '--file',
      join(repositoryRoot, 'infra', 'compose', 'compose.stack.yaml'),
      ...args,
    ],
    {
      stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
      env: {
        ...process.env,
        ...ports,
        ...options.secrets,
        TPS_STACK_WEB_NETWORK: webNetwork,
        TPS_STACK_WEB_SUBNETS: webSubnets(),
      },
    },
  );
}

/** Whether `/api/` on an app's port reaches the API, which names every answer. */
async function forwardsToApi(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/`);
    return response.headers.has('x-request-id');
  } catch {
    return false;
  }
}

async function up(): Promise<number> {
  createWebNetwork();
  const { status } = compose(
    ['up', '--build', '--detach', '--wait', 'api', 'mailpit', 'console', 'portal'],
    { secrets: loadSecrets() },
  );
  if (status !== 0) return status ?? 1;

  const ready = `http://127.0.0.1:${ports.TPS_STACK_API_PORT}/health/ready`;
  const response = await fetch(ready);
  console.log(`${ready} answered ${String(response.status)}: ${await response.text()}`);
  const forwarding = await Promise.all(
    [ports.TPS_STACK_CONSOLE_PORT, ports.TPS_STACK_PORTAL_PORT].map(forwardsToApi),
  );
  if (forwarding.includes(false)) console.error('The console or portal does not reach the API.');
  console.log(`Console: http://console.localhost:${ports.TPS_STACK_CONSOLE_PORT}`);
  console.log(`Portal:  http://portal.localhost:${ports.TPS_STACK_PORTAL_PORT}`);
  console.log(`Mailpit: http://127.0.0.1:${ports.TPS_STACK_MAIL_PORT}`);
  console.log('Fill it with synthetic data with: pnpm stack seed');
  console.log('Stop it with: pnpm stack down');
  return response.ok && !forwarding.includes(false) ? 0 : 1;
}

/** Run the seed on this machine, through a tunnel to the stack's database. */
function seed(args: readonly string[]): number {
  const secrets = loadSecrets();
  ensureSecretFile(join(secretsFolder, 'TPS_STACK_SEED_PASSWORD'));
  const { status } = compose(['up', '--build', '--detach', '--wait', 'database-tunnel'], {
    secrets,
  });
  if (status !== 0) return status ?? 1;
  try {
    const published = compose(['port', 'database-tunnel', '5432'], { capture: true });
    const result = spawnSync(process.execPath, [SEED_SCRIPT, ...args], {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env: seedEnvironment(process.env, publishedPort(published.stdout), secretsFolder),
    });
    return result.status ?? 1;
  } finally {
    compose(['rm', '--stop', '--force', 'database-tunnel']);
  }
}

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 0) return up();
  if (args[0] === 'seed') return seed(args.slice(1));
  const status = compose(args).status ?? 1;
  if (status === 0 && args[0] === 'down') {
    spawnSync('docker', ['network', 'rm', webNetwork], { stdio: 'ignore' });
    if (args.some((arg) => arg === '--volumes' || arg === '-v')) {
      rmSync(secretsFolder, { recursive: true, force: true });
    }
  }
  return status;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2).filter((arg) => arg !== '--'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
