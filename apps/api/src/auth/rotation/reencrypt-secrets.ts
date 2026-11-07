// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The entry point of the secret re-encryption command (command.ts).

import { runSecretReencryption } from './command.ts';

process.exitCode = await runSecretReencryption(process.env, {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});
