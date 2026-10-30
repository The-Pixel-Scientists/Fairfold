// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The clamd client against a fake clamd on a local port.

import { createServer, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { parseReply, scan } from './clamd.ts';

describe('parseReply', () => {
  it('takes only stream: OK as clean', () => {
    expect(parseReply('stream: OK')).toBe('clean');
    for (const reply of ['stream: OK ', 'stream: ok', 'OK', 'stream: OKAY', ' stream: OK', '']) {
      expect(parseReply(reply), reply).toBe('error');
    }
  });

  it('takes a match as infected', () => {
    expect(parseReply('stream: Win.Test.EICAR_HDB-1 FOUND')).toBe('infected');
    expect(parseReply('stream: Heuristics.OLE2.ContainsMacros FOUND')).toBe('infected');
  });

  it('takes everything else as an error, including the alerts for what it could not scan', () => {
    for (const reply of [
      'stream: Heuristics.Encrypted.PDF FOUND',
      'stream: Heuristics.Encrypted.Zip FOUND',
      'stream: Heuristics.Limits.Exceeded FOUND',
      'INSTREAM size limit exceeded. ERROR',
      'stream: Heuristics.Limits.Exceeded FOUND\nstream: OK',
      'stream: OK\nstream: Eicar FOUND',
      'stream:  FOUND',
      'UNKNOWN COMMAND',
      'stream: Heuristics.Limits.Exceeded ERROR',
    ]) {
      expect(parseReply(reply), reply).toBe('error');
    }
  });
});

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

/** A clamd that reads to the zero-length chunk, then calls `answer`. */
async function fakeClamd(answer: (socket: Socket) => void) {
  const received: Buffer[] = [];
  const port = await listen(
    createServer((socket) => {
      let data = Buffer.alloc(0);
      socket.on('error', () => undefined);
      socket.on('data', (chunk: Buffer) => {
        data = Buffer.concat([data, chunk]);
        if (data.length >= 14 && data.subarray(-4).equals(Buffer.alloc(4))) {
          received.push(data);
          answer(socket);
        }
      });
    }),
  );
  return { port, received };
}

const settings = (port: number, timeoutMs = 2000) => ({ host: '127.0.0.1', port, timeoutMs });

describe('scan', () => {
  it('frames the bytes in length-prefixed chunks of at most 64 KB, ending with a zero chunk', async () => {
    const fake = await fakeClamd((socket) => socket.end('stream: OK\0'));
    const bytes = Buffer.alloc(150_000, 7);
    expect(await scan(settings(fake.port), bytes)).toBe('clean');

    const [data] = fake.received;
    expect(data?.subarray(0, 10).toString('latin1')).toBe('zINSTREAM\0');
    let at = 10;
    const sizes: number[] = [];
    const payload: Buffer[] = [];
    for (;;) {
      const size = data?.readUInt32BE(at) ?? 0;
      at += 4;
      if (size === 0) break;
      sizes.push(size);
      payload.push(data?.subarray(at, at + size) ?? Buffer.alloc(0));
      at += size;
    }
    expect(sizes).toEqual([65_536, 65_536, 18_928]);
    expect(Buffer.concat(payload).equals(bytes)).toBe(true);
    expect(at).toBe(data?.length);
  });

  it('sends only the terminator for no bytes', async () => {
    const fake = await fakeClamd((socket) => socket.end('stream: OK\0'));
    expect(await scan(settings(fake.port), new Uint8Array())).toBe('clean');
  });

  it('reads a reply that arrives in pieces', async () => {
    const fake = await fakeClamd((socket) => {
      socket.write('stream: Win.Test');
      setTimeout(() => socket.end('.EICAR_HDB-1 FOUND\0'), 30);
    });
    expect(await scan(settings(fake.port), Buffer.from('x'))).toBe('infected');
  });

  it('ends as an error on a reply that stops before its NUL', async () => {
    const fake = await fakeClamd((socket) => socket.end('stream: OK'));
    expect(await scan(settings(fake.port), Buffer.from('x'))).toBe('error');
  });

  it('ends as an error when bytes follow the NUL', async () => {
    const fake = await fakeClamd((socket) => socket.end('stream: OK\0stream: OK\0'));
    expect(await scan(settings(fake.port), Buffer.from('x'))).toBe('error');
  });

  it('ends as an error on a reply that is not a verdict, or that never ends', async () => {
    const odd = await fakeClamd((socket) => socket.end('INSTREAM size limit exceeded. ERROR\0'));
    expect(await scan(settings(odd.port), Buffer.from('x'))).toBe('error');
    const long = await fakeClamd((socket) => socket.end(`${'a'.repeat(5000)}\0`));
    expect(await scan(settings(long.port), Buffer.from('x'))).toBe('error');
  });

  it('ends as an error when the connection is refused', async () => {
    const closed = await fakeClamd(() => undefined);
    servers.pop()?.close();
    expect(await scan(settings(closed.port), Buffer.from('x'))).toBe('error');
  });

  it('ends as an error at the timeout, and closes the socket', async () => {
    let closed = false;
    const port = await listen(
      createServer((socket) => {
        socket.on('error', () => undefined);
        socket.resume();
        socket.on('close', () => {
          closed = true;
        });
      }),
    );
    const started = Date.now();
    expect(await scan(settings(port, 200), Buffer.from('x'))).toBe('error');
    expect(Date.now() - started).toBeLessThan(2000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(true);
  });

  it('does not take a clean reply that comes before the whole file was sent', async () => {
    const port = await listen(
      createServer((socket) => {
        socket.on('error', () => undefined);
        socket.on('data', () => undefined);
        socket.write('stream: OK\0');
      }),
    );
    expect(await scan(settings(port), Buffer.alloc(5_000_000))).toBe('error');
  });
});
