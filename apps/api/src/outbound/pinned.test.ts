// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer, type Server } from 'node:http';

import { fetch as undiciFetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startStub, type Stub } from '../../test/outbound-stub.ts';
import { HIBP, pinnedFetch, pinnedHttpsDispatcher, pinnedSocketOptions } from './pinned.ts';

let stub: Stub;

beforeAll(async () => {
  stub = await startStub((_request, response) => {
    response.end('hello');
  });
});

afterAll(async () => {
  await stub.close();
});

async function codeOf(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    const { cause } = error as { cause?: { code?: unknown } };
    return cause?.code;
  }
  return 'it succeeded';
}

describe('a client pinned to an HTTPS destination', () => {
  it('refuses any other host', async () => {
    const dispatcher = pinnedHttpsDispatcher({ host: '127.0.0.1', port: stub.port });

    expect(await codeOf(undiciFetch('https://other.test/', { dispatcher }))).toBe(
      'destination_refused',
    );
    expect(
      await codeOf(undiciFetch('https://localhost:' + String(stub.port), { dispatcher })),
    ).toBe('destination_refused');
  });

  it('refuses any other port on the pinned host', async () => {
    const dispatcher = pinnedHttpsDispatcher({ host: '127.0.0.1', port: stub.port });

    expect(
      await codeOf(undiciFetch(`https://127.0.0.1:${String(stub.port + 1)}/`, { dispatcher })),
    ).toBe('destination_refused');
  });

  it('refuses plain HTTP to the pinned host and port', async () => {
    const dispatcher = pinnedHttpsDispatcher({ host: '127.0.0.1', port: stub.port });

    expect(
      await codeOf(undiciFetch(`http://127.0.0.1:${String(stub.port)}/`, { dispatcher })),
    ).toBe('destination_refused');
  });

  it('reaches a private address that is the pinned host, and still verifies its certificate', async () => {
    const dispatcher = pinnedHttpsDispatcher({ host: '127.0.0.1', port: stub.port });

    // The stub's certificate is not trusted: the handshake fails, which shows
    // that the connection was made and that verification is on.
    expect(
      await codeOf(undiciFetch(`https://127.0.0.1:${String(stub.port)}/`, { dispatcher })),
    ).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
  });

  it('matches an IPv6 literal host with or without brackets, and refuses another', async () => {
    const dispatcher = pinnedHttpsDispatcher({ host: '::1', port: stub.port });

    expect(
      await codeOf(undiciFetch(`https://[::1]:${String(stub.port)}/`, { dispatcher })),
    ).not.toBe('destination_refused');
    expect(await codeOf(undiciFetch(`https://[::2]:${String(stub.port)}/`, { dispatcher }))).toBe(
      'destination_refused',
    );
  });

  it('fixes the Have I Been Pwned destination in code', () => {
    expect(HIBP).toEqual({ host: 'api.pwnedpasswords.com', port: 443 });
    expect(Object.isFrozen(HIBP)).toBe(true);
  });
});

describe('fetch pinned to a configured endpoint', () => {
  let plain: Server;
  let plainPort: number;

  beforeAll(async () => {
    plain = createServer((_request, response) => {
      response.end('stored');
    });
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    plainPort = (plain.address() as { port: number }).port;
  });

  afterAll(() => {
    plain.close();
  });

  it('reaches a plain HTTP endpoint on a private address when the operator configured one', async () => {
    const pinned = pinnedFetch(new URL(`http://127.0.0.1:${String(plainPort)}`));

    const response = await pinned(`http://127.0.0.1:${String(plainPort)}/bucket/key`);

    expect(await response.text()).toBe('stored');
  });

  it('refuses any other host, port or scheme than the endpoint', async () => {
    const pinned = pinnedFetch(new URL(`http://127.0.0.1:${String(plainPort)}`));

    for (const url of [
      'http://other.test/',
      `http://127.0.0.1:${String(plainPort + 1)}/`,
      `https://127.0.0.1:${String(plainPort)}/`,
    ]) {
      expect(await codeOf(pinned(url))).toBe('destination_refused');
    }
  });

  it('reaches an IPv6-literal endpoint and refuses a different IPv6 address', async () => {
    const v6 = createServer((_request, response) => {
      response.end('stored');
    });
    await new Promise<void>((resolve) => v6.listen(0, '::1', resolve));
    const port = (v6.address() as { port: number }).port;
    try {
      const pinned = pinnedFetch(new URL(`http://[::1]:${String(port)}`));

      const response = await pinned(`http://[::1]:${String(port)}/bucket/key`);

      expect(await response.text()).toBe('stored');
      expect(await codeOf(pinned(`http://[::2]:${String(port)}/`))).toBe('destination_refused');
    } finally {
      v6.close();
    }
  });

  it('refuses plain HTTP when the endpoint is HTTPS', async () => {
    const pinned = pinnedFetch(new URL('https://storage.test'));

    expect(await codeOf(pinned('http://storage.test/'))).toBe('destination_refused');
  });
});

describe('socket options for a pinned TCP destination', () => {
  it('carry the host and port, with certificate checking and an idle limit, and cannot change', () => {
    const options = pinnedSocketOptions({ host: 'mail.internal.test', port: 587 });

    expect(options).toMatchObject({
      host: 'mail.internal.test',
      port: 587,
      servername: 'mail.internal.test',
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
    expect(options.timeout).toBeGreaterThan(0);
    expect(Object.isFrozen(options)).toBe(true);
  });
});
