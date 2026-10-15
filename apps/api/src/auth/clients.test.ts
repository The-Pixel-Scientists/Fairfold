// SPDX-License-Identifier: AGPL-3.0-or-later

import { once } from 'node:events';
import { connect } from 'node:net';

import { fastify, type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientTracker } from './clients.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** An app that tracks every request, with a route that waits until released. */
async function start() {
  const clients = clientTracker();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let seenAfter: unknown = 'not yet';
  app = fastify();
  app.addHook('onRequest', (request, reply, done) => {
    clients.track(request, reply);
    done();
  });
  app.get('/slow', async (request) => {
    entered();
    await released;
    seenAfter = clients.get(request.id);
    return 'done';
  });
  app.get('/quick', (request) => clients.get(request.id)?.userAgent ?? 'none');
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('Not listening on TCP.');
  return { app, clients, port: address.port, started, release, seenAfter: () => seenAfter };
}

describe('clientTracker', () => {
  it('keeps a request’s client while it runs, and nothing once it is answered', async () => {
    const { app, clients, port } = await start();
    const injected = await app.inject({ url: '/quick', headers: { 'user-agent': 'synthetic' } });
    expect(injected.body).toBe('synthetic');
    const fetched = await fetch(`http://127.0.0.1:${port}/quick`, {
      headers: { 'user-agent': 'synthetic' },
    });
    expect(await fetched.text()).toBe('synthetic');
    await vi.waitFor(() => {
      expect(clients.size).toBe(0);
    });
  });

  it('forgets a request whose client goes away before the response', async () => {
    const { clients, port, started, release, seenAfter } = await start();
    const socket = connect(port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write(
      `GET /slow HTTP/1.1\r\nHost: localhost\r\nUser-Agent: ${'x'.repeat(8000)}\r\n\r\n`,
    );
    await started;
    expect(clients.size).toBe(1);
    socket.destroy();
    await vi.waitFor(() => {
      expect(clients.size).toBe(0);
    });
    release();
    await vi.waitFor(() => {
      expect(seenAfter()).toBeUndefined();
    });
  });
});
