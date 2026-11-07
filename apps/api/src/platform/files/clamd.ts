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

import { SIGNATURE_VERSION_TTL_SECONDS } from '@pixel-scientists/domain/files';

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

/** clamd's `VERSION` reply is `ClamAV <program>/<signature version>/<date>`. */
export function parseVersion(reply: string): number | null {
  const match = /^ClamAV [^/\r\n]+\/(\d{1,9})\/[^\r\n]*$/.exec(reply);
  return match === null ? null : Number(match[1]);
}

/** The signature database version clamd runs, or null if it cannot say. */
export function signatureVersion(settings: FileSettings['clamd']): Promise<number | null> {
  return new Promise((resolve) => {
    const socket: Socket = connect({ host: settings.host, port: settings.port });
    let reply = Buffer.alloc(0);
    const finish = (version: number | null): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(version);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, settings.timeoutMs);
    socket.on('error', () => {
      finish(null);
    });
    socket.on('close', () => {
      finish(null);
    });
    socket.on('connect', () => {
      socket.write('zVERSION\0');
    });
    socket.on('data', (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      const end = reply.indexOf(0);
      if (end === -1) {
        if (reply.length > MAX_REPLY_BYTES) finish(null);
        return;
      }
      finish(end === reply.length - 1 ? parseVersion(reply.toString('latin1', 0, end)) : null);
    });
  });
}

/** The signature version, asked for again only after the cache's lifetime; an unknown version is never kept. */
export function cachedVersion(
  read: () => Promise<number | null>,
  now: () => number = Date.now,
): () => Promise<number | null> {
  let kept: { readonly version: number; readonly until: number } | undefined;
  return async () => {
    if (kept !== undefined && kept.until > now()) return kept.version;
    const version = await read();
    kept =
      version === null
        ? undefined
        : { version, until: now() + SIGNATURE_VERSION_TTL_SECONDS * 1000 };
    return version;
  };
}
