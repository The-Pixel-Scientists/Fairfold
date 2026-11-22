// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tps roles in managed mode, stopped by a signal while the roles script is
// connecting, must leave nothing in the secrets folder but what install
// made. A stand-in server on this machine asks for a cleartext password, so
// the test also sees that the typed password reached the script, then holds
// the connection open while the cli is stopped. POSIX only, as the cli is.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RELEASE_ROOT } from './child.ts';
import { createSecrets, SECRET_NAMES } from './secrets.ts';

const TYPED = 'typed-admin-password';
// Authentication request, cleartext password (PostgreSQL protocol 3).
const ASK_FOR_PASSWORD = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3]);

/** A server that asks for a password, reports it, and then never answers. */
async function passwordTrap() {
  const sockets: Socket[] = [];
  let received: (password: string) => void = () => undefined;
  const password = new Promise<string>((resolve) => (received = resolve));
  const server = createServer((socket) => {
    sockets.push(socket);
    let data = Buffer.alloc(0);
    let asked = false;
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (!asked && data.length >= 4 && data.length >= data.readUInt32BE(0)) {
        asked = true;
        data = data.subarray(data.readUInt32BE(0));
        socket.write(ASK_FOR_PASSWORD);
      }
      // 'p', length, then the password ending in a zero byte.
      if (
        asked &&
        data[0] === 0x70 &&
        data.length >= 5 &&
        data.length >= 1 + data.readUInt32BE(1)
      ) {
        received(data.subarray(5, data.readUInt32BE(1)).toString('utf8'));
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: (server.address() as AddressInfo).port,
    password,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

const folders: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('tps roles stopped part way', () => {
  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
    'leaves no copy of the typed password after %s',
    { timeout: 30_000 },
    async (signal) => {
      const parent = mkdtempSync(join(tmpdir(), 'tps-cli-'));
      folders.push(parent);
      const dir = createSecrets(join(parent, 'secrets'), process.platform);
      const trap = await passwordTrap();
      closers.push(trap.close);

      const cli = spawn(
        process.execPath,
        [join(RELEASE_ROOT, 'tools/cli/src/main.ts'), 'roles', '--secrets-dir', dir],
        {
          env: {
            PATH: process.env['PATH'] ?? '',
            TPS_DB_HOST: '127.0.0.1',
            TPS_DB_PORT: String(trap.port),
            TPS_DB_NAME: 'tps_cli_interrupt',
            TPS_DB_ADMIN_MODE: 'managed',
            TPS_DB_SUPERUSER: 'provider_admin',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let printed = '';
      cli.stdout.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
      cli.stderr.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
      const stoppedBy = new Promise<NodeJS.Signals | null>((resolve) => {
        cli.once('exit', (_code, by) => {
          resolve(by);
        });
      });
      cli.stdin.end(`${TYPED}\n`);

      const reached = await Promise.race([trap.password, stoppedBy.then(() => undefined)]);
      expect(reached, printed).toBe(TYPED);
      cli.kill(signal);
      expect(await stoppedBy).toBe(signal);

      expect(readdirSync(dir).sort()).toEqual([...SECRET_NAMES].sort());
      expect(printed).not.toContain(TYPED);
    },
  );
});
