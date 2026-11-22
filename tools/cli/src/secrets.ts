// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The deployment's secrets: one random value per file, in a folder only its
// owner can open (ADR 0005). Files are made with O_EXCL and mode 0600, then
// checked with fstat, because the umask or the file system can change what
// open() was asked for. Reading opens without following links and checks
// the same again.

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { LOGIN_ROLES, type LoginRole } from '../../../packages/db/scripts/roles.ts';
import { RELEASE_ROOT } from './child.ts';
import { CliError } from './errors.ts';
import type { Output } from './output.ts';

/** A role's password file, named as its Compose secret is (infra/compose/compose.stack.yaml). */
export const rolePasswordFile = (role: LoginRole): string => `${role}_password`;

/** Every secret install makes, by file name, which is also its Compose secret's name. */
export const SECRET_NAMES: readonly string[] = [
  // The bundled database's superuser. A managed database's admin password is typed at the prompt instead.
  'postgres_password',
  ...LOGIN_ROLES.map(rolePasswordFile),
  'auth_secret',
  'request_limit_key',
  'subject_kek',
];

export interface Secrets {
  readonly folder: string;
  /** The path of a secret file, once it is checked to be private. */
  path(name: string): string;
}

function refuseWindows(platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    throw new CliError(
      'Windows file permissions cannot be checked to keep these secrets to your account. ' +
        'Run the cli in WSL, or on the Linux or macOS machine that runs the deployment.',
    );
  }
}

function checkPrivate(stats: Stats, path: string, fix: string): void {
  if ((stats.mode & 0o077) !== 0) {
    throw new CliError(`Other users can open ${path}. Make it yours alone with: ${fix}`);
  }
  if (stats.uid !== process.getuid?.()) {
    throw new CliError(`${path} belongs to another user. Use a folder and files of your own.`);
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function checkOutsideRelease(folder: string): void {
  const inside = relative(RELEASE_ROOT, folder);
  if (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) {
    throw new CliError(
      `${folder} is inside the release folder ${RELEASE_ROOT}. Keep the secrets outside it, so no image or archive can include them.`,
    );
  }
}

function checkFolder(folder: string): void {
  checkOutsideRelease(folder);
  let stats: Stats;
  try {
    stats = lstatSync(folder);
  } catch {
    throw new CliError(
      `${folder} does not exist. Make the secrets first with: tps install --secrets-dir ${folder}`,
    );
  }
  if (!stats.isDirectory()) throw new CliError(`${folder} is not a folder. Name a folder.`);
  checkPrivate(stats, folder, `chmod 700 '${folder}'`);
}

function writePrivate(path: string, value: string): void {
  const fd = openSync(path, 'wx', 0o600);
  let written = false;
  try {
    checkPrivate(fstatSync(fd), path, `chmod 600 '${path}'`);
    writeSync(fd, value);
    written = true;
  } finally {
    closeSync(fd);
    if (!written) rmSync(path, { force: true });
  }
}

function readPrivate(path: string): string {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new CliError(
      `${path} is missing, or is a link. Make it with tps install, or copy the file itself from where you keep the deployment's secrets.`,
    );
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new CliError(`${path} is not a file. Put the secret file there.`);
    checkPrivate(stats, path, `chmod 600 '${path}'`);
    // As readSecret() reads it, so the value hidden is the value used.
    return readFileSync(fd, 'utf8').replace(/\r?\n$/, '');
  } finally {
    closeSync(fd);
  }
}

/**
 * Make every secret in `dir`, creating it with mode 0700 if it is missing.
 * Writes nothing if any of them, or any of `alsoNew`, is already there.
 */
export function createSecrets(
  dir: string,
  platform: NodeJS.Platform,
  alsoNew: readonly string[] = [],
): string {
  refuseWindows(platform);
  const folder = resolve(dir);
  checkOutsideRelease(folder);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  checkFolder(folder);
  const existing = [...SECRET_NAMES, ...alsoNew].filter((name) => exists(join(folder, name)));
  if (existing.length > 0) {
    throw new CliError(
      `${folder} already holds ${existing.join(', ')}. install never replaces a secret: keep the folder as it is, or name an empty one.`,
    );
  }
  for (const name of SECRET_NAMES) {
    writePrivate(join(folder, name), randomBytes(32).toString('base64url'));
  }
  return folder;
}

/** Open the secrets in `dir`, and hide every one of them from `output`. */
export function openSecrets(dir: string, platform: NodeJS.Platform, output: Output): Secrets {
  refuseWindows(platform);
  const folder = resolve(dir);
  checkFolder(folder);
  // A command that needs a missing one says so through path().
  for (const name of SECRET_NAMES) {
    const path = join(folder, name);
    if (exists(path)) output.protect(readPrivate(path));
  }
  return {
    folder,
    path(name) {
      const path = join(folder, name);
      output.protect(readPrivate(path));
      return path;
    },
  };
}
