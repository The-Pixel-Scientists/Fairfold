// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The replay command's options: a batch limit from 1 to 5,000 and
// --dry-run, nothing else. Bad input prints the usage and exits 2 before
// any setting is read or any connection made.

import { describe, expect, it } from 'vitest';

import { runAuditCopyReplay } from './command.ts';

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAuditCopyReplay(
    argv,
    {},
    { out: (text) => out.push(text), err: (text) => err.push(text) },
  );
  return { code, out, err };
}

describe('the audit-copy replay command', () => {
  it.each([
    [['--limit', '0']],
    [['--limit', '5001']],
    [['--limit', '-1']],
    [['--limit', '1.5']],
    [['--limit', '0x10']],
    [['--limit', '']],
    [['--tenant', '6f1c2d3e-0000-4000-8000-000000000001']],
    [['--event', '6f1c2d3e-0000-4000-8000-000000000001']],
    [['6f1c2d3e-0000-4000-8000-000000000001']],
    [['--dry-run=yes']],
  ])('refuses %j with the usage', async (argv) => {
    const { code, out, err } = await run(argv);
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err).toEqual([expect.stringMatching(/^Usage: replay-command\.ts /)]);
  });

  it('reads the settings, and says what is missing, only for good options', async () => {
    const { code, err } = await run(['--limit', '5000', '--dry-run']);
    expect(code).toBe(2);
    expect(err.join('\n')).not.toMatch(/^Usage/);
    expect(err.length).toBeGreaterThan(0);
  });
});
