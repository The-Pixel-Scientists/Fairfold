// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Names for a worktree's development resources (ADR 0005): its database,
// test database, storage bucket and block of ports. They derive from the
// worktree's folder name, and two worktrees of one clone never share any of
// them.
//
//   node scripts/dev-names.ts   prints this worktree's names as JSON

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** PostgreSQL cuts identifiers at 63 bytes; S3 bucket names stop at 63 characters. */
const MAX_NAME_LENGTH = 63;
const HASH_LENGTH = 8;

/** Ports for the apps: one block of ten per worktree, from 41000 to 48999. */
const FIRST_PORT = 41000;
const PORTS_PER_BLOCK = 10;
const PORT_BLOCKS = 800;

export interface DevNames {
  worktree: string;
  database: string;
  testDatabase: string;
  bucket: string;
  ports: { api: number; console: number; portal: number };
}

/** Lower-case the folder name and replace every character outside [a-z0-9_] with `_`. */
export function slugify(folder: string): string {
  const slug = folder.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (slug === '') throw new Error('The worktree folder needs a name.');
  return slug;
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, HASH_LENGTH);
}

/** Keep a name within `max` characters, replacing its tail with a hash of the full name. */
export function fitName(name: string, max: number, separator: string): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - HASH_LENGTH - separator.length)}${separator}${hashOf(name)}`;
}

export function databaseNames(slug: string): { database: string; testDatabase: string } {
  const base = `pixelgrant_${slug}`;
  const suffix = '_test';
  return {
    database: fitName(base, MAX_NAME_LENGTH, '_'),
    testDatabase: `${fitName(base, MAX_NAME_LENGTH - suffix.length, '_')}${suffix}`,
  };
}

/** S3 bucket names allow lower-case letters, digits and hyphens, and must end in a letter or digit. */
export function bucketName(slug: string): string {
  const raw = `pixelgrant-${slug.replace(/_/g, '-')}`;
  const trimmed = raw.replace(/-+$/, '');
  // Trimming could make two slugs meet ("a" and "a_"), so a trimmed name gets a hash.
  const name = trimmed === raw ? raw : `${trimmed}-${hashOf(raw)}`;
  return fitName(name, MAX_NAME_LENGTH, '-');
}

/**
 * Give each worktree a block of ports. A worktree prefers the block its
 * name hashes to; on a clash, worktrees are taken in name order and the
 * later one moves to the next free block.
 */
export function portBlocks(slugs: readonly string[]): Map<string, number> {
  const unique = [...new Set(slugs)].sort();
  if (unique.length > PORT_BLOCKS) throw new Error('Too many worktrees for the port range.');
  const taken = new Set<number>();
  const blocks = new Map<string, number>();
  for (const slug of unique) {
    let block = Number.parseInt(hashOf(slug), 16) % PORT_BLOCKS;
    while (taken.has(block)) block = (block + 1) % PORT_BLOCKS;
    taken.add(block);
    blocks.set(slug, block);
  }
  return blocks;
}

/**
 * Names for the worktree in folder `worktree`, given the folder names of the
 * clone's other worktrees.
 */
export function devNames(worktree: string, otherWorktrees: readonly string[] = []): DevNames {
  const slug = slugify(worktree);
  const clash = otherWorktrees.find((other) => slugify(other) === slug);
  if (clash !== undefined) {
    throw new Error(
      `Worktrees "${worktree}" and "${clash}" would share database names. Rename one of the folders.`,
    );
  }
  const block = portBlocks([slug, ...otherWorktrees.map(slugify)]).get(slug) ?? 0;
  const firstPort = FIRST_PORT + block * PORTS_PER_BLOCK;
  return {
    worktree,
    ...databaseNames(slug),
    bucket: bucketName(slug),
    ports: { api: firstPort, console: firstPort + 1, portal: firstPort + 2 },
  };
}

/** The root of the checkout this script belongs to. */
export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function samePath(a: string, b: string): boolean {
  const normalise = (path: string): string => {
    const resolved = resolve(path);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalise(a) === normalise(b);
}

/** Paths of every worktree of this clone, or none if git cannot say. */
function listWorktrees(root: string): string[] {
  try {
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
  } catch {
    return [];
  }
}

/** Names for the worktree this script runs from. */
export function currentDevNames(root = repositoryRoot): DevNames {
  const others = listWorktrees(root)
    .filter((path) => !samePath(path, root))
    .map((path) => basename(path));
  return devNames(basename(resolve(root)), others);
}

if (import.meta.main) {
  console.log(JSON.stringify(currentDevNames(), null, 2));
}
