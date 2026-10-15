// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A small SMTP server on the loopback address for the sender's tests. It
// speaks just enough SMTP to take one message, and each option makes it
// refuse, stall or drop the connection at one step.

import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { TLSSocket } from 'node:tls';

export interface StubOptions {
  /** Close the connection as soon as it opens. */
  dropOnConnect?: boolean;
  /** Accept the connection and say nothing. */
  silent?: boolean;
  /** Stop answering once this command arrives. */
  stallAt?: 'EHLO' | 'MAIL' | 'RCPT';
  /** Close the connection when this command arrives. */
  dropAt?: 'EHLO' | 'MAIL' | 'RCPT';
  /** Answer this command with an SMTP error. */
  refuse?: 'STARTTLS' | 'AUTH' | 'MAIL' | 'RCPT' | 'DATA';
  /** Offer STARTTLS and upgrade with this key and certificate. */
  tls?: { key: string; cert: string };
}

export interface Stub {
  readonly port: number;
  /** Each message taken: the envelope and the raw text. */
  readonly messages: { from: string; to: string[]; data: string }[];
  close(): Promise<void>;
}

export async function startStub(options: StubOptions = {}): Promise<Stub> {
  const messages: Stub['messages'] = [];
  const sockets = new Set<Socket>();

  function serve(socket: Socket, upgraded: boolean): void {
    let buffer = '';
    let envelope: { from: string; to: string[] } = { from: '', to: [] };
    let data: string | undefined;
    const say = (line: string): void => {
      socket.write(`${line}\r\n`);
    };
    const handle = (line: string): void => {
      const command = line.split(' ')[0]?.toUpperCase() ?? '';
      const step = command === 'EHLO' || command === 'MAIL' || command === 'RCPT' ? command : '';
      if (options.dropAt === step) return void socket.destroy();
      if (options.stallAt === step) return;
      if (command === 'EHLO') {
        const offers = options.tls !== undefined && !upgraded ? ['250-STARTTLS'] : [];
        for (const offer of ['250-stub', ...offers, '250 AUTH PLAIN LOGIN']) say(offer);
      } else if (command === 'STARTTLS') {
        if (options.refuse === 'STARTTLS' || options.tls === undefined) {
          say('502 5.5.1 STARTTLS not available');
        } else {
          say('220 Ready to start TLS');
          socket.removeAllListeners('data');
          serve(new TLSSocket(socket, { isServer: true, ...options.tls }), true);
        }
      } else if (command === 'AUTH') {
        say(options.refuse === 'AUTH' ? '535 5.7.8 Login failed' : '235 Accepted');
      } else if (command === 'MAIL') {
        envelope = { from: /<(.*)>/.exec(line)?.[1] ?? '', to: [] };
        say(options.refuse === 'MAIL' ? '550 5.7.1 Sender refused' : '250 OK');
      } else if (command === 'RCPT') {
        envelope.to.push(/<(.*)>/.exec(line)?.[1] ?? '');
        say(options.refuse === 'RCPT' ? '550 5.1.1 No such user' : '250 OK');
      } else if (command === 'DATA') {
        if (options.refuse === 'DATA') {
          say('554 5.3.0 Message refused');
        } else {
          data = '';
          say('354 Go ahead');
        }
      } else if (command === 'QUIT') {
        say('221 Bye');
        socket.end();
      } else {
        say('250 OK');
      }
    };
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (data !== undefined) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          messages.push({ ...envelope, data: data + buffer.slice(0, end) });
          buffer = buffer.slice(end + 5);
          data = undefined;
          say('250 OK queued');
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        handle(line);
      }
    });
    socket.on('error', () => undefined);
  }

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (options.dropOnConnect === true) return void socket.destroy();
    serve(socket, false);
    if (options.silent !== true) socket.write('220 stub ESMTP\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A loopback port with nothing listening on it. */
export async function closedPort(): Promise<number> {
  const stub = await startStub();
  const { port } = stub;
  await stub.close();
  return port;
}
