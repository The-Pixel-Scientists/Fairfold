// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The clamd client (ADR 0047): one `INSTREAM` scan over `node:net`. The bytes
// go in 4-byte big-endian length-prefixed chunks of at most 64 KB, ended by a
// zero-length chunk, and the reply is read to its NUL. Only `stream: OK` is
// clean and a match is infected; everything else, including the alerts for a
// file clamd could not scan (limits, encryption), a refused connection, a
// timeout, a partial reply and extra bytes, is `error`. The
// reply's text is never returned or logged.

import { connect, type Socket } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { FileSettings } from './settings.ts';

export type Verdict = 'clean' | 'infected' | 'error';

const CHUNK_BYTES = 64 * 1024;
/** A real reply is a line; anything longer is not one. */
const MAX_REPLY_BYTES = 1024;

/**
 * With AlertExceedsMax and AlertEncrypted, clamd reports a file it could not
 * look inside as a match too. Those are not findings, so they are `error`.
 */
const NOT_SCANNED = /^Heuristics\.(?:Limits|Encrypted)\./;

export function parseReply(reply: string): Verdict {
  if (reply === 'stream: OK') return 'clean';
  const match = /^stream: ([^\r\n]+) FOUND$/.exec(reply);
  if (match === null) return 'error';
  return NOT_SCANNED.test(match[1] ?? '') ? 'error' : 'infected';
}

function* frames(bytes: Uint8Array): Generator<Buffer> {
  yield Buffer.from('zINSTREAM\0');
  for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
    const chunk = bytes.subarray(at, at + CHUNK_BYTES);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(chunk.length);
    yield Buffer.concat([size, chunk]);
  }
  yield Buffer.alloc(4);
}

export function scan(settings: FileSettings['clamd'], bytes: Uint8Array): Promise<Verdict> {
  return new Promise((resolve) => {
    const socket: Socket = connect({ host: settings.host, port: settings.port });
    let reply = Buffer.alloc(0);
    let sent = false;
    // The socket is closed on every path, and the first verdict stands.
    const finish = (verdict: Verdict): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(verdict);
    };
    const timer = setTimeout(() => {
      finish('error');
    }, settings.timeoutMs);

    socket.on('error', () => {
      finish('error');
    });
    socket.on('close', () => {
      finish('error');
    });
    socket.on('data', (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      const end = reply.indexOf(0);
      if (end === -1) {
        if (reply.length > MAX_REPLY_BYTES) finish('error');
        return;
      }
      // Nothing may follow the NUL, and no verdict counts before the whole file was sent.
      const verdict =
        end === reply.length - 1 ? parseReply(reply.toString('latin1', 0, end)) : 'error';
      finish(verdict === 'clean' && !sent ? 'error' : verdict);
    });
    socket.on('connect', () => {
      pipeline(Readable.from(frames(bytes)), socket, { end: false }).then(
        () => {
          sent = true;
        },
        () => {
          finish('error');
        },
      );
    });
  });
}
