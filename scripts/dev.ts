// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm dev` (ADR 0005): start the development services in Compose if they
// are not running, prepare and migrate this worktree's database, then run
// the API, console and portal on this machine with reload, on this
// worktree's ports (dev-names.ts). The API gets the `api` profile of
// dev-env.ts. The console and portal get no TPS_ variable but the
// API's address, so their Vite servers proxy `/api` to it on their own
// origin. Ctrl+C stops the apps and leaves the services running.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

import { developmentEnvironment, viteEnvironment } from './dev-env.ts';
import { currentDevNames, repositoryRoot } from './dev-names.ts';

interface App {
  name: string;
  folder: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** The script behind a package's command, as installed for the workspace in `folder`. */
function commandScript(folder: string, packageName: string): string {
  const require = createRequire(join(repositoryRoot, folder, 'package.json'));
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin: string | Record<string, string>;
  };
  const script = typeof bin === 'string' ? bin : bin[packageName];
  if (script === undefined) throw new Error(`${packageName} has no command line.`);
  return join(dirname(manifestPath), script);
}

function runOrExit(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Start an app with Node.js, prefixing each line it prints with its name. */
function start(app: App): ChildProcess {
  const child = spawn(process.execPath, app.args, {
    cwd: join(repositoryRoot, app.folder),
    env: app.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `${app.name.padEnd(7)} | `;
  createInterface({ input: child.stdout }).on('line', (line) => {
    process.stdout.write(`${prefix}${line}\n`);
  });
  createInterface({ input: child.stderr }).on('line', (line) => {
    process.stderr.write(`${prefix}${line}\n`);
  });
  return child;
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    // The whole tree: tsx runs the API in a process of its own.
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

runOrExit('docker', [
  'compose',
  '--file',
  'infra/compose/compose.dev.yaml',
  'up',
  '--detach',
  '--wait',
]);
runOrExit(process.execPath, [
  'scripts/dev-env.ts',
  'database-admin',
  'node',
  'packages/db/scripts/db.ts',
  'prepare',
  'up',
]);

const { ports } = currentDevNames();
const vite = (name: string, port: number): App => ({
  name,
  folder: `apps/${name}`,
  args: [
    commandScript(`apps/${name}`, 'vite'),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  env: viteEnvironment(process.env, ports.api),
});
const apps: App[] = [
  {
    name: 'api',
    folder: 'apps/api',
    args: [commandScript('apps/api', 'tsx'), 'watch', '--clear-screen=false', 'src/main.ts'],
    env: developmentEnvironment('api'),
  },
  vite('console', ports.console),
  vite('portal', ports.portal),
];

console.log(`Console: http://console.localhost:${String(ports.console)}`);
console.log(`Portal:  http://portal.localhost:${String(ports.portal)}`);
console.log(`API:     http://127.0.0.1:${String(ports.api)}/health/ready`);

// If one app stops by itself, the others stop too, so a failure is not lost
// in the output.
const children = apps.map(start);
let stopping = false;
function stopAll(): void {
  stopping = true;
  children.forEach(stop);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
for (const [index, child] of children.entries()) {
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`The ${apps[index]?.name ?? ''} app stopped, so the others are stopping too.`);
    process.exitCode = code ?? 1;
    stopAll();
  });
}
