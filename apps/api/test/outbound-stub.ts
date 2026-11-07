// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A local HTTPS server for the outbound tests, with a certificate made for the
// run by the `openssl` command line tool. The tests reach it through a
// resolver that names public addresses and a connector that dials this server,
// so the address policy under test is the real one.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { isIP, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';

import type { Resolve } from '../src/outbound/connect.ts';

export interface Stub {
  readonly port: number;
  readonly ca: string;
  /** The server names clients sent, in order. */
  readonly serverNames: string[];
  /** The headers of each request received, in order. */
  readonly requests: IncomingMessage['headers'][];
  close(): Promise<void>;
}

let certificate: { key: string; cert: string } | undefined;

function makeCertificate(): { key: string; cert: string } {
  if (certificate !== undefined) return certificate;
  const folder = mkdtempSync(join(tmpdir(), 'tps-stub-'));
  try {
    execFileSync(
      'openssl',
      [
        ...['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'],
        ...['-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem')],
        ...['-subj', '/CN=stub.test', '-days', '1'],
        ...['-addext', 'subjectAltName=DNS:stub.test,DNS:other.test,IP:127.0.0.1'],
      ],
      { stdio: 'ignore' },
    );
    certificate = {
      key: readFileSync(join(folder, 'key.pem'), 'utf8'),
      cert: readFileSync(join(folder, 'cert.pem'), 'utf8'),
    };
    return certificate;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export type StubHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** Answers an Upgrade request, which the server would otherwise treat as a plain one. */
export type StubUpgrade = (request: IncomingMessage, socket: Duplex) => void;

export async function startStub(handler: StubHandler, upgrade?: StubUpgrade): Promise<Stub> {
  const { key, cert } = makeCertificate();
  const serverNames: string[] = [];
  const requests: IncomingMessage['headers'][] = [];
  const listener: RequestListener = (request, response) => {
    requests.push(request.headers);
    handler(request, response);
  };
  const server: Server = createServer({ key, cert }, listener);
  server.on('secureConnection', (socket) => {
    serverNames.push(socket.servername || '');
  });
  if (upgrade) server.on('upgrade', upgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    ca: cert,
    serverNames,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A resolver for the tests: these names resolve to these addresses, and an IP literal to itself. */
export const TEST_HOSTS: Readonly<Record<string, readonly string[]>> = {
  'stub.test': ['93.184.216.34'],
  'other.test': ['93.184.216.35'],
  'wrong-name.test': ['93.184.216.36'],
  'mixed.test': ['93.184.216.34', '10.0.0.5'],
  'private.test': ['10.0.0.5'],
  'metadata.test': ['169.254.169.254'],
  'loopback.test': ['127.0.0.1'],
  'mapped.test': ['::ffff:7f00:1'],
  'empty.test': [],
};

export const testResolve: Resolve = (host) => {
  const addresses = TEST_HOSTS[host] ?? (isIP(host) === 0 ? undefined : [host]);
  return addresses === undefined
    ? Promise.reject(new Error('no such host'))
    : Promise.resolve(addresses);
};
