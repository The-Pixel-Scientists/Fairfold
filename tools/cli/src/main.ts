#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tps: install, set up and check a deployment (tools/cli/README.md).

import { runScript } from './child.ts';
import { run } from './cli.ts';
import { redactingOutput } from './output.ts';
import { promptSecret } from './prompt.ts';

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  platform: process.platform,
  output: redactingOutput({
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }),
  runScript,
  prompt: promptSecret,
  fetch,
});
