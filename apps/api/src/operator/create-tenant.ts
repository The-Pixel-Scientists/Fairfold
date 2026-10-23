// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The entry point of `pnpm tenant:create` (command.ts).

import { runCreateTenant } from './command.ts';

process.exitCode = await runCreateTenant(process.argv.slice(2), process.env, {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});
