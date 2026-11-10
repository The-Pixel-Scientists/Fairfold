// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Running the external commands. Each gets only the environment it is given,
// so nothing inherited can change its connection or carry a credential, and
// its error output is dropped, because it can name hosts and files.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { BackupError, type FailureCode } from './codes.ts';

export interface Stage {
  path: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  failure: FailureCode;
}

export function launch(stage: Stage) {
  const child = spawn(stage.path, [...stage.args], {
    env: { ...stage.env },
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  // A command that exits early breaks the pipe; its exit code reports that.
  child.stdin.on('error', () => undefined);
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', () => {
      reject(new BackupError(stage.failure));
    });
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new BackupError(stage.failure));
    });
  });
  return { child, finished };
}

/** Runs a command and returns what it printed. */
export async function runTool(stage: Stage, input = ''): Promise<string> {
  const { child, finished } = launch(stage);
  child.stdin.end(input);
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  await finished;
  return Buffer.concat(chunks).toString('utf8');
}

/** Streams one command's output into another, failing if either fails. */
export async function pipeStages(first: Stage, second: Stage, tap?: Transform): Promise<void> {
  const from = launch(first);
  const to = launch(second);
  from.child.stdin.end();
  to.child.stdout.resume();
  const streams = tap
    ? pipeline(from.child.stdout, tap, to.child.stdin)
    : pipeline(from.child.stdout, to.child.stdin);
  const transfer = streams.catch(() => {
    throw new BackupError(first.failure);
  });
  await Promise.all([from.finished, to.finished, transfer]);
}

/** A pass-through that measures what crosses it. */
export function hashingTap(): { tap: Transform; digest: () => { sha256: string; size: number } } {
  const hash = createHash('sha256');
  let size = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  return { tap, digest: () => ({ sha256: hash.digest('hex'), size }) };
}

export async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { sha256: hash.digest('hex'), size: (await stat(path)).size };
}

/** The first line a stream prints, leaving it flowing so the command can exit. */
export function firstLine(stream: Readable): Promise<string | undefined> {
  return new Promise((resolve) => {
    let text = '';
    stream.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const end = text.indexOf('\n');
      if (end >= 0) resolve(text.slice(0, end));
    });
    stream.once('end', () => {
      resolve(undefined);
    });
  });
}
