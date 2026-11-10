// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after } from 'node:test';

import { BackupError } from './codes.ts';
import { firstLine, hashFile, hashingTap, pipeStages, runTool, type Stage } from './exec.ts';
import { describe, it } from './testing.ts';

const node = (script: string, failure: Stage['failure'] = 'dump_failed'): Stage => ({
  path: process.execPath,
  args: ['-e', script],
  env: {},
  failure,
});

const scratch = mkdtempSync(join(tmpdir(), 'backup-exec-test-'));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('runTool', () => {
  it('returns what the command printed', async () => {
    assert.equal(await runTool(node('process.stdout.write("hello")')), 'hello');
  });

  it('passes input on standard input', async () => {
    const stage = node('process.stdin.pipe(process.stdout)');
    assert.equal(await runTool(stage, 'piped'), 'piped');
  });

  it('gives the command only the environment it was handed', async () => {
    process.env['BACKUP_TEST_SECRET'] = 'do-not-inherit';
    const stage: Stage = {
      ...node('process.stdout.write(String(process.env.BACKUP_TEST_SECRET))'),
      env: { OTHER: '1' },
    };
    assert.equal(await runTool(stage), 'undefined');
  });

  it('turns a failure into its code, not the message', async () => {
    await assert.rejects(
      runTool(node('console.error("password=secret"); process.exit(3)', 'store_failed')),
      (error: unknown) => error instanceof BackupError && error.code === 'store_failed',
    );
  });

  it('reports a command that cannot be started by its code', async () => {
    await assert.rejects(
      runTool({ ...node(''), path: join(scratch, 'no-such-tool'), failure: 'dump_failed' }),
      BackupError,
    );
  });
});

describe('pipeStages', () => {
  const copyToFile = (file: string): Stage =>
    node(
      `const fs=require('fs');process.stdin.pipe(fs.createWriteStream(${JSON.stringify(file)}))`,
      'encrypt_failed',
    );

  it('streams one command into another and through a tap', async () => {
    const output = join(scratch, 'piped');
    const { tap, digest } = hashingTap();
    await pipeStages(node('process.stdout.write("hello")'), copyToFile(output), tap);
    assert.equal(readFileSync(output, 'utf8'), 'hello');
    assert.deepEqual(digest(), {
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      size: 5,
    });
  });

  it('fails if the first command fails, even with output written', async () => {
    await assert.rejects(
      pipeStages(
        node('process.stdout.write("partial"); process.exitCode = 1'),
        copyToFile(join(scratch, 'partial')),
      ),
      (error: unknown) => error instanceof BackupError && error.code === 'dump_failed',
    );
  });

  it('fails if the second command fails', async () => {
    await assert.rejects(
      pipeStages(
        node('process.stdout.write("x".repeat(1e6))'),
        node('process.exit(4)', 'encrypt_failed'),
      ),
      BackupError,
    );
  });
});

describe('hashFile', () => {
  it('hashes a file and reports its size', async () => {
    const file = join(scratch, 'hashed');
    writeFileSync(file, 'hello');
    assert.deepEqual(await hashFile(file), {
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      size: 5,
    });
  });
});

describe('firstLine', () => {
  it('returns the first line of a stream', async () => {
    assert.equal(await firstLine(Readable.from([Buffer.from('one\ntwo\n')])), 'one');
  });

  it('returns undefined when the stream ends first', async () => {
    assert.equal(await firstLine(Readable.from([Buffer.from('no newline')])), undefined);
  });
});
