// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ADR 0010's outbound tests for `node:http` and `node:https`, through the
// agents. Redirects are followed the way a library does, one new request for
// each hop.

import { get as httpGet } from 'node:http';
import { get as httpsGet, request as httpsRequest } from 'node:https';
import { createServer, type Server, type Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStub, testResolve, type Stub } from '../../test/outbound-stub.ts';
import { OutboundHttpAgent, OutboundHttpsAgent } from './agents.ts';
import { LIMITS } from './limits.ts';

let stub: Stub;
let dials: ConnectionOptions[];

const agentFor = (port: () => number, limits = LIMITS) =>
  new OutboundHttpsAgent({
    resolve: testResolve,
    limits,
    connect: (options) => {
      dials.push(options);
      return tlsConnect({ ...options, host: '127.0.0.1', port: port(), ca: stub.ca });
    },
  });

interface Reply {
  status: number;
  body: string;
  location: string | undefined;
}

/** One request. Rejects with the error, whose `code` is the refusal. */
function request(url: string, agent: OutboundHttpsAgent): Promise<Reply> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { agent }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString(),
          location: response.headers.location,
        });
      });
    }).on('error', reject);
  });
}

/** Follow redirects as a library does, making a new request for each. */
async function follow(url: string, agent: OutboundHttpsAgent): Promise<Reply> {
  let target = url;
  for (let hop = 0; hop < 10; hop++) {
    const reply = await request(target, agent);
    if (reply.location === undefined) return reply;
    target = new URL(reply.location, target).href;
  }
  throw new Error('followed ten redirects');
}

async function codeOf(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return 'it succeeded';
}

beforeAll(async () => {
  stub = await startStub(
    (req, response) => {
      const path = req.url ?? '/';
      const chain = /^\/chain\/(\d+)$/.exec(path);
      if (chain) {
        const left = Number(chain[1]);
        if (left === 0) response.end('arrived');
        else response.writeHead(302, { location: `/chain/${String(left - 1)}` }).end();
      } else if (path.startsWith('/to/')) {
        response.writeHead(302, { location: decodeURIComponent(path.slice(4)) }).end();
      } else if (path === '/big') response.end(Buffer.alloc(1024 * 1024 + 1));
      else if (path === '/exact') response.end(Buffer.alloc(1024 * 1024));
      else if (path === '/stream') {
        response.write(Buffer.alloc(600 * 1024));
        response.write(Buffer.alloc(600 * 1024));
        response.end();
      } else if (path === '/gzip') {
        response
          .writeHead(200, { 'content-encoding': 'gzip' })
          .end(gzipSync(Buffer.alloc(50 * 1024 * 1024)));
      } else if (path === '/two-encodings') {
        response
          .writeHead(200, [
            ['content-encoding', 'identity'],
            ['content-encoding', 'identity'],
          ])
          .end('hello');
      } else if (path === '/identity') {
        response.writeHead(200, { 'content-encoding': 'identity' }).end('hello');
      } else if (path === '/head-gzip') {
        response.writeHead(200, { 'content-encoding': 'gzip' }).end();
      } else if (path === '/stall-headers') return;
      else if (path === '/drip') {
        response.writeHead(200);
        const timer = setInterval(() => response.write('x'), 100);
        response.on('close', () => {
          clearInterval(timer);
        });
      } else response.end('hello');
    },
    (_req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n');
    },
  );
});

afterAll(async () => {
  await stub.close();
});

describe('node:https through the outbound agent', () => {
  it('reaches a public host, connecting to the address that was checked with the host as server name', async () => {
    dials = [];
    const reply = await request(
      'https://stub.test/',
      agentFor(() => stub.port),
    );

    expect(reply.body).toBe('hello');
    expect(dials).toMatchObject([
      { host: '93.184.216.34', servername: 'stub.test', rejectUnauthorized: true },
    ]);
  });

  it('does not let a request turn certificate checking off', async () => {
    dials = [];
    await request(
      'https://stub.test/',
      agentFor(() => stub.port),
    );
    const agent = agentFor(() => stub.port);

    await new Promise<void>((resolve, reject) => {
      // Deliberate: a request that turns certificate checking off, to prove the agent overrides it.
      const checkingOff = false;
      // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
      httpsGet('https://stub.test/', { agent, rejectUnauthorized: checkingOff }, (response) => {
        response.resume();
        resolve();
      }).on('error', reject);
    });
    expect(dials.at(-1)).toMatchObject({ rejectUnauthorized: true });
  });

  it('refuses a certificate that does not match the host name', async () => {
    const agent = agentFor(() => stub.port);

    expect(await codeOf(request('https://wrong-name.test/', agent))).toBe(
      'ERR_TLS_CERT_ALTNAME_INVALID',
    );
  });

  it.each([
    ['a private address', 'https://private.test/'],
    ['one public and one private address', 'https://mixed.test/'],
    ['the metadata address', 'https://metadata.test/'],
    ['a loopback address', 'https://loopback.test/'],
    ['an IPv4-mapped loopback address', 'https://mapped.test/'],
    ['the metadata address as a literal', 'https://169.254.169.254/'],
    ['a loopback literal', 'https://127.0.0.1/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['NAT64 around the metadata address', 'https://[64:ff9b::a9fe:a9fe]/'],
  ])('refuses %s', async (_what, url) => {
    dials = [];
    expect(
      await codeOf(
        request(
          url,
          agentFor(() => stub.port),
        ),
      ),
    ).toBe('address_refused');
    expect(dials).toEqual([]);
  });

  it('refuses a host given in an options object in a form getaddrinfo accepts', async () => {
    dials = [];
    const agent = new OutboundHttpsAgent({
      connect: (options) => {
        dials.push(options);
        return tlsConnect(options);
      },
    });

    for (const host of ['0177.0.0.1', '2130706433', '0x7f.1']) {
      const attempt = new Promise((resolve, reject) => {
        httpsGet({ host, agent, path: '/' }, resolve).on('error', reject);
      });
      expect(['address_refused', 'unresolvable']).toContain(await codeOf(attempt));
    }
    expect(dials).toEqual([]);
  });

  it('refuses an Upgrade request, and a 101 the server sends anyway', async () => {
    const agent = agentFor(() => stub.port);
    const upgrading = new Promise((resolve, reject) => {
      httpsGet('https://stub.test/upgrade', { agent, headers: { Upgrade: 'websocket' } }, resolve)
        .on('upgrade', resolve)
        .on('error', reject);
    });
    expect(await codeOf(upgrading)).toBe('method_refused');

    // The header is added after the agent saw the request, so only the 101 itself is refused.
    let upgraded = false;
    const late = new Promise((resolve, reject) => {
      const req = httpsRequest('https://stub.test/upgrade', { agent })
        .on('upgrade', () => {
          upgraded = true;
          resolve(undefined);
        })
        .on('response', resolve)
        .on('error', reject);
      req.setHeader('Connection', 'Upgrade');
      req.setHeader('Upgrade', 'websocket');
      req.end();
    });
    expect(await codeOf(late)).toBe('method_refused');
    expect(upgraded).toBe(false);
  });

  it('refuses a UNIX socket path and a tunnel', async () => {
    const agent = agentFor(() => stub.port);
    const attempt = new Promise((resolve, reject) => {
      httpsGet({ socketPath: '/var/run/docker.sock', agent, path: '/' }, resolve).on(
        'error',
        reject,
      );
    });

    expect(await codeOf(attempt)).toBe('method_refused');
  });

  describe('redirects', () => {
    it('allows three', async () => {
      const reply = await follow(
        'https://stub.test/chain/3',
        agentFor(() => stub.port),
      );

      expect(reply.body).toBe('arrived');
    });

    it('refuses a fourth', async () => {
      expect(
        await codeOf(
          follow(
            'https://stub.test/chain/4',
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('too_many_redirects');
    });

    it('counts hops made with a different agent each time', async () => {
      let target = 'https://stub.test/chain/4';
      const attempt = async () => {
        for (let hop = 0; hop < 10; hop++) {
          const reply = await request(
            target,
            agentFor(() => stub.port),
          );
          if (reply.location === undefined) return;
          target = new URL(reply.location, target).href;
        }
      };

      expect(await codeOf(attempt())).toBe('too_many_redirects');
    });

    it.each([
      ['the metadata address', 'https://169.254.169.254/latest'],
      ['a loopback address', 'https://127.0.0.1:8080/'],
      ['a host that resolves to loopback', 'https://loopback.test/'],
    ])('refuses a redirect to %s', async (_what, target) => {
      const url = `https://stub.test/to/${encodeURIComponent(target)}`;

      expect(
        await codeOf(
          follow(
            url,
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('address_refused');
    });

    it('refuses a redirect to plain HTTP', async () => {
      const url = `https://stub.test/to/${encodeURIComponent('http://other.test/')}`;

      expect(
        await codeOf(
          follow(
            url,
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('scheme_refused');
    });

    it('refuses a redirect to a URL with credentials', async () => {
      const url = `https://stub.test/to/${encodeURIComponent('https://user:secret@other.test/')}`;

      expect(
        await codeOf(
          follow(
            url,
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('redirect_refused');
    });
  });

  describe('a client that acts in its response callback', () => {
    it('is never shown a redirect beyond the third', async () => {
      const agent = agentFor(() => stub.port);
      let shown = 0;
      const attempt = new Promise((resolve, reject) => {
        const go = (target: string): void => {
          httpsGet(target, { agent }, (response) => {
            shown += 1;
            const { location } = response.headers;
            response.resume();
            if (location === undefined) resolve(shown);
            else go(new URL(location, target).href);
          }).on('error', reject);
        };
        go('https://stub.test/chain/9');
      });

      expect(await codeOf(attempt)).toBe('too_many_redirects');
      expect(shown).toBe(3);
    });

    it('is never given a chunk that takes the body over 1 MB', async () => {
      const agent = agentFor(() => stub.port);
      let seen = 0;
      const attempt = new Promise((resolve, reject) => {
        httpsGet('https://stub.test/stream', { agent }, (response) => {
          response.on('data', (chunk: Buffer) => {
            seen += chunk.length;
          });
          response.on('error', reject);
          response.on('end', resolve);
        }).on('error', reject);
      });

      expect(await codeOf(attempt)).toBe('body_too_large');
      expect(seen).toBeLessThanOrEqual(LIMITS.maxBodyBytes);
    });
  });

  describe('the response body', () => {
    it('allows 1 MB', async () => {
      const reply = await request(
        'https://stub.test/exact',
        agentFor(() => stub.port),
      );

      expect(reply.body).toHaveLength(1024 * 1024);
    });

    it('refuses a declared length over 1 MB', async () => {
      expect(
        await codeOf(
          request(
            'https://stub.test/big',
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('body_too_large');
    });

    it('refuses a compressed response, which a decoder could expand past the limit', async () => {
      expect(
        await codeOf(
          request(
            'https://stub.test/gzip',
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('encoding_refused');
    });

    it('refuses a repeated Content-Encoding header, even when each value is identity', async () => {
      expect(
        await codeOf(
          request(
            'https://stub.test/two-encodings',
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('encoding_refused');
    });

    it('allows an identity encoding', async () => {
      const reply = await request(
        'https://stub.test/identity',
        agentFor(() => stub.port),
      );

      expect(reply.body).toBe('hello');
    });

    it('asks the server for no compression', async () => {
      await request(
        'https://stub.test/',
        agentFor(() => stub.port),
      );

      expect(stub.requests.at(-1)?.['accept-encoding']).toBe('identity');
    });

    it('does not refuse the encoding of a response to HEAD, which has no body', async () => {
      const agent = agentFor(() => stub.port);
      const status = await new Promise((resolve, reject) => {
        httpsRequest('https://stub.test/head-gzip', { agent, method: 'HEAD' }, (response) => {
          response.resume();
          resolve(response.statusCode);
        })
          .on('error', reject)
          .end();
      });

      expect(status).toBe(200);
    });

    it('refuses a streamed body over 1 MB', async () => {
      expect(
        await codeOf(
          request(
            'https://stub.test/stream',
            agentFor(() => stub.port),
          ),
        ),
      ).toBe('body_too_large');
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

    it('gives up on a server that accepts the connection and never completes TLS', async () => {
      expect(
        await codeOf(
          request(
            'https://stub.test/',
            agentFor(() => stalledPort, limits),
          ),
        ),
      ).toBe('timeout');
    });

    it('gives up on a server that never sends headers', async () => {
      expect(
        await codeOf(
          request(
            'https://stub.test/stall-headers',
            agentFor(() => stub.port, limits),
          ),
        ),
      ).toBe('timeout');
    });

    it('gives up on a body that keeps coming past the total limit', async () => {
      expect(
        await codeOf(
          request(
            'https://stub.test/drip',
            agentFor(() => stub.port, limits),
          ),
        ),
      ).toBe('timeout');
    });
  });
});

describe('node:http through the outbound agent', () => {
  it('refuses every request, whatever the address', async () => {
    const agent = new OutboundHttpAgent();

    for (const url of ['http://stub.test/', 'http://127.0.0.1/', 'http://169.254.169.254/']) {
      const attempt = new Promise((resolve, reject) => {
        httpGet(url, { agent }, resolve).on('error', reject);
      });
      expect(await codeOf(attempt)).toBe('scheme_refused');
    }
  });
});
