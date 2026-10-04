// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Tests run on Node.js, but this package has no Node.js types: just enough to list and read files.
const { process } = globalThis as unknown as {
  process: {
    getBuiltinModule(id: 'node:fs'): {
      readdirSync(path: string, options: { recursive: true }): string[];
      readFileSync(path: string, as: 'utf8'): string;
    };
  };
};
const { dirname } = import.meta as unknown as { dirname: string };
const fs = process.getBuiltinModule('node:fs');
const src = `${dirname}/..`;

// Every index.ts under src is an entry point: `.` or a subpath through
// package.json's `./*` export. Found on disk, so a new entry is checked
// without editing this file.
const entries = fs
  .readdirSync(src, { recursive: true })
  .map((path) => path.replaceAll('\\', '/'))
  .filter((path) => /(?:^|\/)index\.ts$/.test(path) && !path.includes('__snapshots__'))
  .map((path) => ({ name: path.replace(/\/?index\.ts$/, '') || '.', path }))
  .sort((a, b) => a.name.localeCompare(b.name));
const switchEntries = entries.filter(({ name }) => name !== 'jitless');

afterEach(() => {
  z.config({ jitless: true });
});

it('finds every entry point on disk', () => {
  expect(entries.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      '.',
      'api',
      'auth',
      'forms',
      'jitless',
      'platform',
      'platform/audit-log',
      'platform/settings',
      'platform/team',
    ]),
  );
});

it.each(switchEntries)('the $name entry imports the switch first', ({ name, path }) => {
  const first = fs
    .readFileSync(`${src}/${path}`, 'utf8')
    .split('\n')
    .find((line) => /^(?:import|export)\b/.test(line));
  const up = name === '.' ? './' : '../'.repeat(name.split('/').length);
  expect(first).toBe(`import '${up}jitless/index.ts';`);
});

it.each(entries)('the $name entry runs zod without eval', async ({ path }) => {
  z.config({ jitless: false });
  vi.resetModules();
  await import(/* @vite-ignore */ `../${path}`);
  expect(z.config().jitless).toBe(true);
});
