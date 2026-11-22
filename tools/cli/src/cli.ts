// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Finding the command, its options and its help, and ending every failure
// with a message that says how to fix it. No option takes a secret.

import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

import { productName } from '@pixel-scientists/domain/platform';

import {
  tenantCreate,
  install,
  migrate,
  roles,
  status,
  type Context,
  type Values,
} from './commands.ts';
import { CliError } from './errors.ts';

interface Command {
  readonly usage: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly options: Readonly<Record<string, string>>;
  readonly run: (values: Values, context: Context) => Promise<number>;
}

const SECRETS_DIR = {
  'secrets-dir <folder>':
    "The folder holding the deployment's secrets, outside the release folder.",
};
const DATABASE_SETTINGS =
  'Settings come from the environment: TPS_DB_HOST, TPS_DB_PORT, TPS_DB_NAME and, for a server elsewhere, TPS_DB_TLS=verify-full.';

export const COMMANDS: Readonly<Record<string, Command>> = {
  install: {
    usage: 'install --secrets-dir <folder>',
    summary: 'Make the secrets and the Compose file that mounts them',
    details: [
      'Make every secret the deployment needs, each in its own file that only you can read, and a Compose file that names those files.',
      'The folder is made if it is missing. install never replaces a secret.',
    ],
    options: {
      'secrets-dir <folder>':
        'Where to keep the secrets, outside the release folder. It must hold no secrets yet.',
    },
    run: install,
  },
  roles: {
    usage: 'roles --secrets-dir <folder>',
    summary: 'Set up the database roles with the roles script',
    details: [
      'Set up the database, its roles and their passwords with the roles script.',
      DATABASE_SETTINGS,
      'TPS_DB_SUPERUSER names the role the script runs as. On a server on this machine it is the superuser, with its password in postgres_password.',
      "For a managed database, set TPS_DB_ADMIN_MODE=managed and TPS_DB_SUPERUSER to its admin role. You are asked for that role's password, which is not shown as you type. Every role is then checked.",
    ],
    options: SECRETS_DIR,
    run: roles,
  },
  migrate: {
    usage: 'migrate --secrets-dir <folder>',
    summary: 'Apply pending database migrations',
    details: [
      'Check the roles, then apply every pending migration as migrator, naming each one.',
      DATABASE_SETTINGS,
    ],
    options: SECRETS_DIR,
    run: migrate,
  },
  'tenant create': {
    usage:
      'tenant create --secrets-dir <folder> --slug <slug> --name <name> --admin-email <address> --modules <id,id>',
    summary: 'Create a tenant with its tools and invite its first administrator',
    details: [
      'Create a tenant, switch on the tools you list, and invite its first administrator by email.',
      'No tool is on unless you list it. The invitation goes by email only and is never printed.',
      `${DATABASE_SETTINGS} The invitation also needs TPS_CONSOLE_ORIGIN and the TPS_SMTP_ settings.`,
    ],
    options: {
      ...SECRETS_DIR,
      'slug <slug>': "The short name in the tenant's addresses, such as northfield-trust.",
      'name <name>': "The organisation's name, as people see it.",
      'admin-email <address>': 'Who to invite as the first administrator.',
      'modules <id,id>': 'The tools to switch on, separated by commas, such as grants.',
    },
    run: tenantCreate,
  },
  status: {
    usage: 'status --secrets-dir <folder> [--api <address>]',
    summary: 'Check the deployment without changing anything',
    details: [
      'Check, without changing anything: the database connection and its TLS, the roles, pending migrations, the worker and, with --api, the API.',
      DATABASE_SETTINGS,
    ],
    options: {
      ...SECRETS_DIR,
      'api <address>':
        "The API's own address, such as http://127.0.0.1:3000, to ask whether it is ready.",
    },
    run: status,
  },
};

function optionList(options: Readonly<Record<string, string>>): string[] {
  const entries = Object.entries({ ...options, help: 'Show this help.' });
  const width = Math.max(...entries.map(([flag]) => flag.length)) + 4;
  return entries.map(([flag, about]) => `  --${flag.padEnd(width - 2)}${about}`);
}

export function mainHelp(): string[] {
  const names = Object.keys(COMMANDS);
  const width = Math.max(...names.map((name) => name.length)) + 2;
  return [
    'Usage: tps <command> [options]',
    '',
    `Install, set up and check a ${productName} deployment, one cell at a time.`,
    '',
    'Commands:',
    ...names.map((name) => `  ${name.padEnd(width)}${COMMANDS[name]?.summary ?? ''}`),
    '',
    'Run tps <command> --help to see its options.',
    'Settings come from the environment and secrets from files only: no option takes a secret.',
  ];
}

export function commandHelp(command: Command): string[] {
  return [
    `Usage: tps ${command.usage}`,
    '',
    ...command.details,
    '',
    'Options:',
    ...optionList(command.options),
  ];
}

function parseOptions(name: string, command: Command, args: readonly string[]): Values {
  const options: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
  for (const flag of Object.keys(command.options)) {
    options[flag.split(' ')[0] ?? flag] = { type: 'string' };
  }
  try {
    return parseArgs({ args: [...args], options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const option = /'(-[^' ]+)/.exec(error instanceof Error ? error.message : '')?.[1];
    const fix = `Run tps ${name} --help to see its options.`;
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && option !== undefined) {
      throw new CliError(`tps ${name} has no option ${option}. ${fix}`, 2);
    }
    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' && option !== undefined) {
      throw new CliError(`Give ${option} a value. ${fix}`, 2);
    }
    if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') {
      throw new CliError(`tps ${name} takes options only. ${fix}`, 2);
    }
    throw new CliError(`The options for tps ${name} are not valid. ${fix}`, 2);
  }
}

/** Run the cli and return its exit code. Every failure is printed, redacted, on standard error. */
export async function run(argv: readonly string[], context: Context): Promise<number> {
  const { output } = context;
  const [first, second] = argv;
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    const lines = mainHelp();
    for (const line of lines) (first === undefined ? output.err : output.out)(line);
    return first === undefined ? 2 : 0;
  }
  const name = first === 'tenant' && second === 'create' ? 'tenant create' : first;
  const command = COMMANDS[name];
  if (command === undefined) {
    output.err(
      `There is no command ${first === 'tenant' ? `tenant ${second ?? ''}`.trim() : first}. ` +
        'Use install, roles, migrate, tenant create or status, or run tps --help.',
    );
    return 2;
  }
  try {
    const values = parseOptions(name, command, argv.slice(name.split(' ').length));
    if (values['help'] === true) {
      for (const line of commandHelp(command)) output.out(line);
      return 0;
    }
    return await command.run(values, context);
  } catch (error) {
    output.err(
      error instanceof Error ? error.message : 'The command failed. Run it again with --help.',
    );
    return error instanceof CliError ? error.code : 1;
  }
}
