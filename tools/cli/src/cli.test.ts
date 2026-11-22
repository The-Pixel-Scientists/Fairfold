// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The cli's commands with a stand-in for the release's scripts, which
// records what each was given and, for the redaction test, tries to print
// every secret it can reach. File modes are POSIX's, so the tests that make
// secrets run on Linux and macOS (CI), and Windows is refused.

import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DB_SCRIPT, OPERATOR_SCRIPT, PIPED_SECRET_FILE, RELEASE_ROOT, type Env } from './child.ts';
import { COMMANDS, run } from './cli.ts';
import type { Context } from './commands.ts';
import { COMPOSE_FILE } from './compose.ts';
import { redactingOutput, type Output } from './output.ts';
import { SECRET_NAMES } from './secrets.ts';

const posix = process.platform !== 'win32';

interface Call {
  script: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  piped: string | undefined;
}

function harness(
  options: {
    env?: Env;
    platform?: NodeJS.Platform;
    typed?: string;
    script?: (call: Call, output: Output) => number;
    status?: number;
  } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: Call[] = [];
  const context: Context = {
    env: options.env ?? { TPS_DB_HOST: '127.0.0.1' },
    platform: options.platform ?? process.platform,
    output: redactingOutput({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    }),
    runScript: (script, args, env, output, piped) => {
      const call = { script, args, env, piped };
      calls.push(call);
      return Promise.resolve(options.script?.(call, output) ?? 0);
    },
    prompt: () => Promise.resolve(options.typed ?? ''),
    fetch: () => Promise.resolve(new Response(null, { status: options.status ?? 200 })),
  };
  return {
    calls,
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
    run: (...argv: string[]) => run(argv, context),
  };
}

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A new folder outside the checkout; `secrets` is where install puts its files. */
function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tps-cli-'));
  folders.push(folder);
  return join(folder, 'secrets');
}

async function installed(): Promise<{ dir: string; values: string[] }> {
  const dir = scratch();
  const result = harness();
  expect(await result.run('install', '--secrets-dir', dir), result.stderr()).toBe(0);
  const values = SECRET_NAMES.map((name) => readFileSync(join(dir, name), 'utf8'));
  return { dir, values };
}

describe('help and usage', () => {
  it('lists every command, and each command has its own help', async () => {
    const result = harness();
    expect(await result.run('--help')).toBe(0);
    for (const name of Object.keys(COMMANDS)) expect(result.stdout()).toContain(`  ${name}`);
    for (const name of Object.keys(COMMANDS)) {
      const help = harness();
      expect(await help.run(...name.split(' '), '--help')).toBe(0);
      expect(help.stdout()).toContain(`Usage: tps ${name}`);
      expect(help.calls).toEqual([]);
    }
  });

  it('shows the usage on standard error and fails with no command', async () => {
    const result = harness();
    expect(await result.run()).toBe(2);
    expect(result.stderr()).toContain('Usage: tps <command>');
  });

  it('ends an unknown command or option with how to fix it', async () => {
    const cases: [string[], string][] = [
      [['deploy'], 'There is no command deploy. Use install, roles'],
      [['tenant', 'delete'], 'There is no command tenant delete.'],
      [
        ['migrate', '--password', 'x'],
        'tps migrate has no option --password. Run tps migrate --help',
      ],
      [['migrate', '--secrets-dir'], 'Give --secrets-dir a value.'],
      [['status', 'extra'], 'tps status takes options only.'],
    ];
    for (const [argv, message] of cases) {
      const result = harness();
      expect(await result.run(...argv), argv.join(' ')).toBe(2);
      expect(result.stderr()).toContain(message);
      expect(result.calls).toEqual([]);
    }
  });

  it('has no option that takes a password, token or key', () => {
    for (const command of Object.values(COMMANDS)) {
      for (const flag of Object.keys(command.options)) {
        expect(flag).not.toMatch(/password|token|key|secret(?!s-dir <folder>)/i);
      }
    }
  });
});

describe('refusals before anything runs', () => {
  it('refuses plaintext to a database server elsewhere before any query', async () => {
    for (const tls of [undefined, 'disable']) {
      for (const argv of [
        ['migrate'],
        ['status'],
        ['roles'],
        [
          'tenant',
          'create',
          '--slug=a',
          '--name=A',
          '--admin-email=a@example.test',
          '--modules=grants',
        ],
      ]) {
        const result = harness({
          env: { TPS_DB_HOST: 'db.invalid', TPS_DB_TLS: tls, TPS_DB_ADMIN_MODE: 'managed' },
        });
        expect(await result.run(...argv, '--secrets-dir', '/nowhere'), argv[0]).toBe(1);
        expect(result.stderr()).toContain('reaches it over TLS only');
        expect(result.calls).toEqual([]);
      }
    }
  });

  it('refuses a secret in a setting', async () => {
    const result = harness({
      env: { TPS_DB_HOST: '127.0.0.1', TPS_DB_MIGRATOR_PASSWORD: 'typed-into-the-shell' },
    });
    expect(await result.run('migrate', '--secrets-dir', '/nowhere')).toBe(1);
    expect(result.stderr()).toContain('TPS_DB_MIGRATOR_PASSWORD holds a secret');
    expect(result.stderr()).not.toContain('typed-into-the-shell');
    expect(result.calls).toEqual([]);
  });

  it('refuses the superuser mode for a server elsewhere', async () => {
    const result = harness({ env: { TPS_DB_HOST: 'db.example.org', TPS_DB_TLS: 'verify-full' } });
    expect(await result.run('roles', '--secrets-dir', '/nowhere')).toBe(1);
    expect(result.stderr()).toContain('set TPS_DB_ADMIN_MODE=managed');
  });

  it('refuses a tenant with no tools before anything is written', async () => {
    for (const modules of [[], ['--modules', ' ']]) {
      const result = harness();
      const code = await result.run(
        'tenant',
        'create',
        '--secrets-dir=/nowhere',
        '--slug=northfield',
        '--name=Northfield Trust',
        '--admin-email=first@example.test',
        ...modules,
      );
      expect(code).toBe(2);
      expect(result.stderr()).toContain('No tool is on unless you list it.');
      expect(result.calls).toEqual([]);
    }
  });

  it('refuses an API address with a user name or password', async () => {
    const result = harness();
    const code = await result.run(
      'status',
      '--secrets-dir=/nowhere',
      '--api=http://admin:hunter2@127.0.0.1:3000',
    );
    expect(code).toBe(2);
    expect(result.stderr()).not.toContain('hunter2');
  });

  it('stops on Windows with the fix', async () => {
    const result = harness({ platform: 'win32' });
    expect(await result.run('install', '--secrets-dir', join(tmpdir(), 'never-made'))).toBe(1);
    expect(result.stderr()).toContain('Run the cli in WSL');
  });

  it('refuses a secrets folder inside the release folder, and makes nothing', async () => {
    const inside = join(RELEASE_ROOT, 'tools', 'cli', 'never-made');
    const result = harness({ platform: 'linux' });
    expect(await result.run('install', '--secrets-dir', inside)).toBe(1);
    expect(result.stderr()).toContain('Keep the secrets outside it');
    expect(() => statSync(inside)).toThrow();
  });
});

describe.skipIf(!posix)('install', () => {
  it('makes each secret owner-only in an owner-only folder, and a Compose file with no value', async () => {
    const { dir, values } = await installed();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const name of SECRET_NAMES) {
      expect(statSync(join(dir, name)).mode & 0o777, name).toBe(0o600);
    }
    expect(new Set(values).size).toBe(SECRET_NAMES.length);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const compose = readFileSync(join(dir, COMPOSE_FILE), 'utf8');
    for (const value of values) expect(compose).not.toContain(value);
    for (const name of SECRET_NAMES) {
      expect(compose).toContain(`  ${name}:\n    file: ${JSON.stringify(join(dir, name))}\n`);
    }
  });

  it('never replaces a secret', async () => {
    const { dir, values } = await installed();
    const again = harness();
    expect(await again.run('install', '--secrets-dir', dir)).toBe(1);
    expect(again.stderr()).toContain('install never replaces a secret');
    expect(SECRET_NAMES.map((name) => readFileSync(join(dir, name), 'utf8'))).toEqual(values);
  });

  it('refuses a folder or a file that other users can open, or a link', async () => {
    const { dir } = await installed();

    chmodSync(dir, 0o750);
    const folder = harness();
    expect(await folder.run('migrate', '--secrets-dir', dir)).toBe(1);
    expect(folder.stderr()).toContain(`Make it yours alone with: chmod 700 '${dir}'`);
    chmodSync(dir, 0o700);

    const file = join(dir, 'migrator_password');
    chmodSync(file, 0o640);
    const readable = harness();
    expect(await readable.run('migrate', '--secrets-dir', dir)).toBe(1);
    expect(readable.stderr()).toContain(`chmod 600 '${file}'`);
    expect(readable.calls).toEqual([]);

    rmSync(file);
    symlinkSync(join(dir, 'app_api_password'), file);
    const linked = harness();
    expect(await linked.run('migrate', '--secrets-dir', dir)).toBe(1);
    expect(linked.stderr()).toContain('is missing, or is a link');
  });
});

describe.skipIf(!posix)('the database commands', () => {
  it('run the release scripts with each secret as a file', async () => {
    const { dir } = await installed();
    const result = harness({ env: { TPS_DB_HOST: '127.0.0.1', TPS_DB_SUPERUSER: 'postgres' } });
    expect(await result.run('roles', '--secrets-dir', dir)).toBe(0);
    expect(await result.run('migrate', '--secrets-dir', dir)).toBe(0);
    expect(
      await result.run(
        'tenant',
        'create',
        '--secrets-dir',
        dir,
        '--slug',
        'northfield',
        '--name=-Northfield Trust',
        '--admin-email',
        'first@example.test',
        '--modules',
        'grants',
      ),
    ).toBe(0);
    expect(await result.run('status', '--secrets-dir', dir, '--api', 'http://127.0.0.1:3000')).toBe(
      0,
    );

    expect(result.calls.map(({ script, args }) => [script, args])).toEqual([
      [DB_SCRIPT, ['prepare']],
      [DB_SCRIPT, ['up']],
      [
        OPERATOR_SCRIPT,
        [
          '--slug=northfield',
          '--name=-Northfield Trust',
          '--admin-email=first@example.test',
          '--modules=grants',
        ],
      ],
      [DB_SCRIPT, ['status']],
    ]);
    const [prepare, up, tenant, status] = result.calls;
    expect(prepare?.env['TPS_DB_SUPERUSER_PASSWORD_FILE']).toBe(join(dir, 'postgres_password'));
    expect(prepare?.env['TPS_DB_BACKUP_READER_PASSWORD_FILE']).toBe(
      join(dir, 'backup_reader_password'),
    );
    expect(up?.env['TPS_DB_MIGRATOR_PASSWORD_FILE']).toBe(join(dir, 'migrator_password'));
    expect(tenant?.env['TPS_DB_APP_WORKER_PASSWORD_FILE']).toBe(join(dir, 'app_worker_password'));
    expect(status?.env['TPS_DB_MIGRATOR_PASSWORD_FILE']).toBe(join(dir, 'migrator_password'));
    expect(result.stdout()).toContain('Running roles script version');
    expect(result.stdout()).toContain('API: ready.');
  });

  it('reports an API that is not ready, and fails', async () => {
    const { dir } = await installed();
    const result = harness({ status: 503 });
    expect(await result.run('status', '--secrets-dir', dir, '--api', 'http://127.0.0.1:3000')).toBe(
      1,
    );
    expect(result.stdout()).toContain('API: not ready (HTTP 503).');
  });

  it('pipes the typed admin password to the roles script, and never writes it to a file', async () => {
    const { dir } = await installed();
    const made = readdirSync(dir).sort();
    let running: string[] = [];
    const result = harness({
      env: {
        TPS_DB_HOST: 'db.example.org',
        TPS_DB_TLS: 'verify-full',
        TPS_DB_ADMIN_MODE: 'managed',
        TPS_DB_SUPERUSER: 'cloudsqladmin',
      },
      typed: 'typed-admin-password',
      script: () => {
        // What is on disk while the script runs is what a stopped cli leaves.
        running = readdirSync(dir).sort();
        return 0;
      },
    });
    expect(await result.run('roles', '--secrets-dir', dir)).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.piped).toBe('typed-admin-password');
    expect(result.calls[0]?.env['TPS_DB_SUPERUSER_PASSWORD_FILE']).toBe(PIPED_SECRET_FILE);
    expect(running).toEqual(made);
    expect(readdirSync(dir).sort()).toEqual(made);
  });

  it('never prints a secret, nor passes one in an argument or a setting', async () => {
    const { dir, values } = await installed();
    const typed = 'typed-admin-password';
    const secrets = [...values, typed];
    // A script that prints every secret file it was given, then fails naming one.
    const leaky = (call: Call, output: Output) => {
      for (const [name, path] of Object.entries(call.env)) {
        if (!name.endsWith('_FILE')) continue;
        const value = path === PIPED_SECRET_FILE ? (call.piped ?? '') : readFileSync(path, 'utf8');
        output.out(`${name} is ${value}`);
        output.err(`could not use ${value}`);
      }
      throw new Error(`failed with ${values[1] ?? ''}`);
    };
    const settings = {
      TPS_DB_HOST: '127.0.0.1',
      TPS_DB_SUPERUSER: 'postgres',
      TPS_DB_NAME: 'tps',
    };
    const runs: [Env, string[]][] = [
      [settings, ['roles']],
      [{ ...settings, TPS_DB_ADMIN_MODE: 'managed' }, ['roles']],
      [settings, ['migrate']],
      [
        settings,
        [
          'tenant',
          'create',
          '--slug=a',
          '--name=A',
          '--admin-email=a@example.test',
          '--modules=grants',
        ],
      ],
      [settings, ['status', '--api=http://127.0.0.1:3000']],
    ];
    for (const [env, argv] of runs) {
      const result = harness({ env, typed, script: leaky });
      expect(await result.run(...argv, '--secrets-dir', dir), argv.join(' ')).toBe(1);
      const printed = result.stdout() + result.stderr();
      expect(printed).toContain('[secret]');
      for (const call of result.calls) {
        const passed = [...call.args, ...Object.values(call.env)].join('\n');
        for (const secret of secrets) expect(passed).not.toContain(secret);
      }
      for (const secret of secrets) expect(printed, argv.join(' ')).not.toContain(secret);
    }
  });
});
