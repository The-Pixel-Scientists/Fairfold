// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the auth module keeps about each request: its client, as Fastify
// derived it through the trusted proxies, and the headers its route asked
// for. An entry lasts until the response's connection closes, which happens
// whether the response was sent or the client went away first.

import type { FastifyReply, FastifyRequest } from 'fastify';

export interface Client {
  readonly ip: string;
  readonly userAgent?: string;
  readonly headers: Map<string, string[]>;
}

export function clientTracker() {
  const clients = new Map<string, Client>();
  return {
    /** How many requests are being kept. */
    get size() {
      return clients.size;
    },
    track(request: FastifyRequest, reply: FastifyReply): void {
      const userAgent = request.headers['user-agent'];
      clients.set(request.id, {
        ip: request.ip,
        ...(userAgent === undefined ? {} : { userAgent }),
        headers: new Map(),
      });
      reply.raw.once('close', () => clients.delete(request.id));
    },
    /** The request's client, or undefined once its connection has closed. */
    get(requestId: string): Client | undefined {
      return clients.get(requestId);
    },
  };
}
