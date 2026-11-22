// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Seed code stays out of every release image (ADR 0005). The API image,
// which also runs the worker and the migrate job, and the web image are
// built from only what their .dockerignore files let in. This reads each
// file as Docker does, the last matching line deciding, and checks that no
// file under packages/db/seed/ gets through.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);

/** A .dockerignore line as a test of a path and of every folder it is in. */
function rule(line: string): { readonly keep: boolean; readonly test: (path: string) => boolean } {
  const keep = line.startsWith('!');
  const pattern = (keep ? line.slice(1) : line).replace(/^\/|\/$/g, '');
  const source = pattern
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) =>
      part === '**/'
        ? '(?:.*/)?'
        : part === '**'
          ? '.*'
          : part === '*'
            ? '[^/]*'
            : part === '?'
              ? '[^/]'
              : part.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- patterns come from the repository's own .dockerignore files
  const matcher = new RegExp(`^${source}$`);
  return {
    keep,
    test: (path) => {
      const parts = path.split('/');
      return parts.some((_, end) => matcher.test(parts.slice(0, end + 1).join('/')));
    },
  };
}

/** Whether Docker sends `path` to the build. */
function sent(ignore: string, path: string): boolean {
  let included = true;
  for (const line of ignore.split('\n').map((text) => text.trim())) {
    if (line === '' || line.startsWith('#')) continue;
    const { keep, test } = rule(line);
    if (test(path)) included = keep;
  }
  return included;
}

const seedFiles = readdirSync(new URL('packages/db/seed/', root)).map(
  (name) => `packages/db/seed/${name}`,
);

describe.each(['api.Dockerfile.dockerignore', 'web.Dockerfile.dockerignore'])('%s', (file) => {
  const ignore = readFileSync(fileURLToPath(new URL(`infra/docker/${file}`, root)), 'utf8');

  it('sends no seed file to the image', () => {
    expect(seedFiles.length).toBeGreaterThan(0);
    expect(seedFiles.filter((path) => sent(ignore, path))).toEqual([]);
  });

  it('is read as Docker reads it', () => {
    expect(sent(ignore, 'packages/domain/src/index.ts')).toBe(true);
    expect(sent(ignore, 'packages/domain/src/index.test.ts')).toBe(false);
    expect(sent(ignore, '.env')).toBe(false);
  });
});

it('sends the API what it runs, and the migrations', () => {
  const ignore = readFileSync(
    fileURLToPath(new URL('infra/docker/api.Dockerfile.dockerignore', root)),
    'utf8',
  );
  expect(sent(ignore, 'apps/api/src/main.ts')).toBe(true);
  expect(sent(ignore, 'packages/db/scripts/db.ts')).toBe(true);
  expect(sent(ignore, 'packages/db/migrations/0001_app_schema/up.sql')).toBe(true);
});
