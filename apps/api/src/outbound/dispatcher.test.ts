// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ADR 0010's outbound tests for `fetch`. The tests go through Node.js's global
// `fetch`, with the dispatcher under test set as the global one, so they also
// prove the two share it. Hosts resolve to public addresses and a connector
// dials the local stub; the address policy is the real one.

import { createServer, type Server, type Socket } from 'node:net';
import { gzipSync } from 'node:zlib';

import {
  buildConnector,
  fetch as undiciFetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
  type Agent,
  type Dispatcher,
} from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStub, testResolve, type Stub } from '../../test/outbound-stub.ts';
import { createOutboundDispatcher } from './dispatcher.ts';
import { LIMITS } from './limits.ts';

let stub: Stub;
let dials: { hostname: string; servername: string | undefined }[];
let original: Dispatcher;

const connectorTo = (port: () => number, timeout = 2000): buildConnector.connector => {
  const inner = buildConnector({ ca: stub.ca, timeout, allowH2: false });
  return (options, callback) => {
    dials.push({ hostname: options.hostname, servername: options.servername });
    inner({ ...options, hostname: '127.0.0.1', port: String(port()) }, callback);
  };
};

/** Why a request failed: the code of the refusal behind `fetch failed`. */
async function failure(request: Promise<Response>): Promise<unknown> {
  try {
    const response = await request;
    await response.arrayBuffer();
  } catch (error) {
    return (error as { cause?: { code?: unknown } }).cause?.code ?? error;
  }
  return 'it succeeded';
}

beforeAll(async () => {
  stub = await startStub((request, response) => {
    const path = request.url ?? '/';
    const chain = /^\/chain\/(\d+)$/.exec(path);
    if (chain) {
      const left = Number(chain[1]);
      if (left === 0) response.end('arrived');
      else response.writeHead(302, { location: `/chain/${String(left - 1)}` }).end();
    } else if (path.startsWith('/loop')) response.writeHead(302, { location: '/loop?' }).end();
    else if (path.startsWith('/to/')) {
      response.writeHead(307, { location: decodeURIComponent(path.slice(4)) }).end();
    } else if (path === '/echo') response.end(JSON.stringify(request.headers));
    else if (path === '/big') response.end(Buffer.alloc(1024 * 1024 + 1));
    else if (path === '/exact') response.end(Buffer.alloc(1024 * 1024));
    else if (path === '/stream') {
      response.write(Buffer.alloc(600 * 1024));
      response.write(Buffer.alloc(600 * 1024));
      response.end();
    } else if (path === '/dup-location') {
      const next = '/chain/0';
      response.writeHead(302, ['location', next, 'location', next]).end();
    } else if (path === '/dup-encoding') {
      response
        .writeHead(200, ['content-encoding', 'identity', 'content-encoding', 'identity'])
        .end('hello');
    } else if (path === '/gzip') {
      response.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync('hello'));
    } else if (path === '/stall-headers') return;
    else if (path === '/drip') {
      response.writeHead(200);
      const timer = setInterval(() => response.write('x'), 100);
      response.on('close', () => {
        clearInterval(timer);
      });
    } else response.end('hello');
  });
  original = getGlobalDispatcher();
  setGlobalDispatcher(
    createOutboundDispatcher({ resolve: testResolve, connector: connectorTo(() => stub.port) }),
  );
});

afterAll(async () => {
  setGlobalDispatcher(original);
  await stub.close();
});

describe('fetch through the outbound dispatcher', () => {
  it('reaches a public host, connecting to the address that was checked with the host as server name', async () => {
    dials = [];
    const response = await fetch('https://stub.test/');

    expect(await response.text()).toBe('hello');
    expect(dials).toEqual([{ hostname: '93.184.216.34', servername: 'stub.test' }]);
    expect(stub.serverNames).toContain('stub.test');
  });

  it('refuses a certificate that does not match the host name', async () => {
    expect(await failure(fetch('https://wrong-name.test/'))).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('refuses plain HTTP before it connects', async () => {
    dials = [];
    const plain = new URL('https://stub.test/');
    plain.protocol = 'http:';
    expect(await failure(fetch(plain.href))).toBe('scheme_refused');
    expect(dials).toEqual([]);
  });

  it.each([
    ['a private address', 'https://private.test/'],
    ['one public and one private address', 'https://mixed.test/'],
    ['the metadata address', 'https://metadata.test/'],
    ['a loopback address', 'https://loopback.test/'],
    ['an IPv4-mapped loopback address', 'https://mapped.test/'],
    ['no address', 'https://empty.test/'],
    ['the metadata address as a literal', 'https://169.254.169.254/latest/meta-data'],
    ['a loopback literal', 'https://127.0.0.1/'],
    ['a decimal literal', 'https://2130706433/'],
    ['an octal literal', 'https://0177.0.0.1/'],
    ['a hexadecimal literal', 'https://0x7f.1/'],
    ['a short literal', 'https://127.1/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/'],
    ['the AWS IPv6 metadata address', 'https://[fd00:ec2::254]/'],
    ['NAT64 around the metadata address', 'https://[64:ff9b::a9fe:a9fe]/'],
  ])('refuses %s', async (_what, url) => {
    dials = [];
    expect(await failure(fetch(url))).toBe('address_refused');
    expect(dials).toEqual([]);
  });

  it('refuses a host name that does not resolve, without naming it', async () => {
    expect(await failure(fetch('https://nowhere.test/'))).toBe('unresolvable');
  });

  it('does not add trace context or ask for compression', async () => {
    const sent = (await (await fetch('https://stub.test/echo')).json()) as Record<string, string>;

    expect(sent['traceparent']).toBeUndefined();
    expect(sent['tracestate']).toBeUndefined();
    expect(sent['accept-encoding']).toBe('identity');
  });

  it('refuses a compressed response', async () => {
    expect(await failure(fetch('https://stub.test/gzip'))).toBe('encoding_refused');
  });

  it('refuses a repeated Content-Encoding header', async () => {
    expect(await failure(fetch('https://stub.test/dup-encoding'))).toBe('encoding_refused');
  });

  describe('redirects', () => {
    it('follows three', async () => {
      const response = await fetch('https://stub.test/chain/3');

      expect(await response.text()).toBe('arrived');
    });

    it('refuses a fourth', async () => {
      expect(await failure(fetch('https://stub.test/chain/4'))).toBe('too_many_redirects');
    });

    it('refuses a loop', async () => {
      expect(await failure(fetch('https://stub.test/loop'))).toBe('too_many_redirects');
    });

    it('counts a chain whose target ends in a question mark', async () => {
      expect(await failure(fetch('https://stub.test/loop?'))).toBe('too_many_redirects');
    });

    it.each([
      ['the metadata address', 'https://169.254.169.254/latest/meta-data'],
      ['a loopback address', 'https://127.0.0.1:8080/'],
      ['a host that resolves to loopback', 'https://loopback.test/'],
      ['IPv6 loopback', 'https://[::1]/'],
    ])('refuses a redirect to %s', async (_what, target) => {
      expect(await failure(fetch(`https://stub.test/to/${encodeURIComponent(target)}`))).toBe(
        'address_refused',
      );
    });

    it('refuses a redirect with a repeated Location header, which fetch would follow unseen', async () => {
      expect(await failure(fetch('https://stub.test/dup-location'))).toBe('redirect_refused');
    });

    it('refuses a redirect to plain HTTP', async () => {
      const target = encodeURIComponent('http://other.test/');
      expect(await failure(fetch(`https://stub.test/to/${target}`))).toBe('scheme_refused');
    });

    it('refuses a redirect to a URL with credentials', async () => {
      const target = encodeURIComponent('https://user:secret@other.test/');
      expect(await failure(fetch(`https://stub.test/to/${target}`))).toBe('redirect_refused');
    });

    it('follows a 307 that keeps the method, to a public host', async () => {
      const target = encodeURIComponent('https://other.test/');
      const response = await fetch(`https://stub.test/to/${target}`, { method: 'POST', body: 'x' });

      expect(await response.text()).toBe('hello');
    });
  });

  describe('the response body', () => {
    it('allows 1 MB', async () => {
      const response = await fetch('https://stub.test/exact');

      expect((await response.arrayBuffer()).byteLength).toBe(1024 * 1024);
    });

    it('refuses a declared length over 1 MB before reading any of it', async () => {
      expect(await failure(fetch('https://stub.test/big'))).toBe('body_too_large');
    });

    it('refuses a streamed body over 1 MB', async () => {
      expect(await failure(fetch('https://stub.test/stream'))).toBe('body_too_large');
    });
  });
});

describe('the dispatcher', () => {
  it.each([
    ['an http: origin with an absolute https: path', 'http://stub.test', 'https://stub.test/x'],
    ['an http: origin', 'http://stub.test', '/x'],
    ['an https: origin with an absolute path', 'https://stub.test', 'https://stub.test/x'],
    ['an https: origin with a protocol-relative path', 'https://stub.test', '//other.test/x'],
    [
      'an https: origin with a path starting with a backslash',
      'https://stub.test',
      String.raw`/\other.test`,
    ],
    ['an https: origin with a path that is not a path', 'https://stub.test', 'x'],
  ])('refuses %s', async (_what, origin, path) => {
    dials = [];
    const dispatcher = createOutboundDispatcher({
      resolve: testResolve,
      connector: connectorTo(() => stub.port),
    });

    await expect(dispatcher.request({ origin, path, method: 'GET' })).rejects.toMatchObject({
      code: 'scheme_refused',
    });
    expect(dials).toEqual([]);
  });

  it.each([
    ['a tunnel', { method: 'CONNECT' }],
    ['an upgrade', { method: 'GET', upgrade: 'websocket' }],
  ])('refuses %s', (_what, options) => {
    const dispatcher = createOutboundDispatcher({
      resolve: testResolve,
      connector: connectorTo(() => stub.port),
    });
    const errors: unknown[] = [];
    dispatcher.dispatch(
      { origin: 'https://stub.test', path: '/', ...options },
      {
        onResponseError: (_controller, error) => {
          errors.push(error);
        },
      },
    );

    expect(errors).toMatchObject([{ code: 'method_refused' }]);
  });
});

describe('time limits', () => {
  const limits = {
    connectMs: 200,
    headersMs: 300,
    totalMs: 600,
    maxBodyBytes: LIMITS.maxBodyBytes,
  };
  const sockets = new Set<Socket>();
  let stalled: Server;
  let stalledPort: number;

  beforeAll(async () => {
    stalled = createServer((socket) => sockets.add(socket));
    await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', resolve));
    stalledPort = (stalled.address() as { port: number }).port;
  });

  afterAll(() => {
    stalled.close();
    for (const socket of sockets) socket.destroy();
  });

  const limited = (port: () => number): Agent =>
    createOutboundDispatcher({
      resolve: testResolve,
      connector: connectorTo(port, limits.connectMs),
      limits,
    }) as Agent;

  const timeoutOf = async (url: string, dispatcher: Dispatcher): Promise<unknown> => {
    try {
      const response = await undiciFetch(url, { dispatcher });
      await response.arrayBuffer();
    } catch (error) {
      return (error as { cause?: { code?: unknown } }).cause?.code;
    }
    return 'it succeeded';
  };

  it('gives up on a server that accepts the connection and never completes TLS', async () => {
    expect(
      await timeoutOf(
        'https://stub.test/',
        limited(() => stalledPort),
      ),
    ).toBe('timeout');
  });

  it('gives up on a server that never sends headers', async () => {
    expect(
      await timeoutOf(
        'https://stub.test/stall-headers',
        limited(() => stub.port),
      ),
    ).toBe('timeout');
  });

  it('gives up on a body that keeps coming past the total limit', async () => {
    const started = Date.now();

    expect(
      await timeoutOf(
        'https://stub.test/drip',
        limited(() => stub.port),
      ),
    ).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(limits.totalMs + 400);
  });
});
