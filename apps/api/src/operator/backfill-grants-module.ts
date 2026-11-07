// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The entry point of the grants backfill (backfill-command.ts). The root
// package.json script is the lead's to add:
//   "tenants:backfill-grants": "node scripts/dev-env.ts operator node apps/api/src/operator/backfill-grants-module.ts"

import { runBackfillGrants } from './backfill-command.ts';

process.exitCode = await runBackfillGrants(process.argv.slice(2), process.env, {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});
