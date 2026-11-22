// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Loaded by cli.test.ts with --import, before the converter: every way to
// reach the network fails, and says so on standard error.

import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';

const NETWORK_TRIED = 'The converter tried to reach the network.';

function refuse(): never {
  process.stderr.write(`${NETWORK_TRIED}\n`);
  throw new Error(NETWORK_TRIED);
}

Object.assign(globalThis, { fetch: refuse, WebSocket: refuse });
Object.assign(net.Socket.prototype, { connect: refuse });
Object.assign(dgram.Socket.prototype, { send: refuse, connect: refuse });
for (const resolver of [dns, dns.promises]) {
  Object.assign(resolver, { lookup: refuse, resolve: refuse, resolve4: refuse, resolve6: refuse });
}
