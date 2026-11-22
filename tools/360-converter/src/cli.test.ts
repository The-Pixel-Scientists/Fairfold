// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The command as a user runs it, under Node.js's permission model: it may
// read the repository and the test's folder, and write only the output file
// named. Every network call is stubbed to fail (offline.fixture.ts). All
// data is synthetic.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { suiteName } from '@pixel-scientists/domain/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { columns } from './convert.ts';

const root = resolve(import.meta.dirname, '../../..');
const cli = join(import.meta.dirname, 'cli.ts');
const offline = pathToFileURL(join(import.meta.dirname, 'offline.fixture.ts')).href;
/** What the stub prints. It is not imported, so this process keeps its network. */
const NETWORK_TRIED = 'The converter tried to reach the network.';

const funder = [
  '--funder-name',
  'Northfield Foundation',
  '--funder-identifier',
  'GB-CHC-7654321',
  '--identifier-prefix',
  '360G-northfield',
];
const row =
  'NF-2027-001,Spring 2027,Small grants for community groups.,2500,GBP,2027-05-14,Riverside Food Bank,1234567,GB-CHC,Community grants';

let folder: string;
let input: string;
let output: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), '360-converter-'));
  input = join(folder, 'grants.csv');
  output = join(folder, 'grants.json');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function run(args: readonly string[], node: readonly string[] = [cli]) {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${root}`,
      `--allow-fs-read=${folder}`,
      `--allow-fs-write=${output}`,
      '--import',
      offline,
      ...node,
      ...args,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  expect(result.stderr).not.toContain(NETWORK_TRIED);
  return result;
}

describe('360-converter', { timeout: 60_000 }, () => {
  it('has a stub that catches a network call', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', offline, '-e', "fetch('http://example.test')"],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(NETWORK_TRIED);
  });

  it('shows its name from the brand and its options', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${suiteName} 360Giving converter`);
    expect(result.stdout).toContain('--identifier-prefix');
  });

  it('writes the file named and nothing else, with a summary on standard error', () => {
    writeFileSync(input, `${columns.join(',')}\n${row}\n`);
    const result = run([input, ...funder, '--output', output]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Converted 1 grant to ${output}.`);
    expect(result.stderr).toContain('1 recipient identifier is not checked against a register.');
    const file = JSON.parse(readFileSync(output, 'utf8')) as { grants: { id: string }[] };
    expect(file.grants.map((grant) => grant.id)).toEqual(['360G-northfield-NF-2027-001']);
    expect(readdirSync(folder).sort()).toEqual(['grants.csv', 'grants.json']);
  });

  it('writes to standard output without --output', () => {
    writeFileSync(input, `${columns.join(',')}\n${row}\n`);
    const result = run([input, ...funder]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ grants: [{ amountAwarded: 2500 }] });
    expect(readdirSync(folder)).toEqual(['grants.csv']);
  });

  it('writes no file when any row is wrong, and lists every problem', () => {
    const wrong = row
      .replace('NF-2027-001', 'NF-2027-002')
      .replace('2500', '£2500')
      .replace('2027-05-14', '14/05/2027');
    writeFileSync(input, `${columns.join(',')}\n${row}\n${wrong}\n`);
    const result = run([input, ...funder, '--output', output]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'No file written. Fix these problems, then convert the file again:\n- Row 3, Amount:',
    );
    expect(result.stderr).toContain('- Row 3, Award date:');
    expect(result.stderr).not.toContain('£2500');
    expect(readdirSync(folder)).toEqual(['grants.csv']);
  });

  it('refuses a file that is not UTF-8', () => {
    writeFileSync(input, Buffer.from([0x47, 0x72, 0x61, 0x6e, 0x74, 0xff, 0x0a]));
    const result = run([input, ...funder, '--output', output]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The file is not UTF-8.');
    expect(readdirSync(folder)).toEqual(['grants.csv']);
  });

  it('says how to run it when the file or an option is wrong', () => {
    expect(run([]).stderr).toContain('Name one CSV file to convert.');
    expect(run([input, '--colour']).stderr).toContain(
      'The command has an option the converter does not know.',
    );
    expect(run([input, ...funder]).stderr).toContain(`Cannot open ${input}.`);
  });
});
