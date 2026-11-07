// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The entry point of the audit-copy replay command (command.ts).

import { runAuditCopyReplay } from './command.ts';

process.exitCode = await runAuditCopyReplay(process.argv.slice(2), process.env, {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});
