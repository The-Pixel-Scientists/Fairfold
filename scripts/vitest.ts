// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs Vitest with the arguments given, less the first `--`. pnpm passes the
// `--` in `pnpm test -- packages/db` through to the script, and Vitest
// ignores every file filter after it.
//
//   node scripts/vitest.ts run [options and filters...]

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const manifestPath = require.resolve('vitest/package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin: Record<string, string> };
const bin = manifest.bin['vitest'];
if (!bin) throw new Error('Could not find the Vitest command line.');

const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator !== -1) args.splice(separator, 1);

const result = spawnSync(process.execPath, [join(dirname(manifestPath), bin), ...args], {
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
