// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The global agents behind `node:http` and `node:https` (ADR 0010), which
// meet the same rules as the dispatcher. `OutboundHttpAgent` refuses every
// request. `OutboundHttpsAgent` checks the address at connect time and
// connects to the address it checked, with the URL's host as the server name
// and certificate checking on. It also limits each request's time, redirects
// and response size. A caller that passes its own agent is not covered:
// Semgrep bans `new Agent` outside this folder.

import {
  Agent as HttpAgent,
  type ClientRequest,
  type ClientRequestArgs,
  type IncomingMessage,
} from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIPv6 } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls';

import { checkedAddress, serverName, systemResolve, type Resolve } from './connect.ts';
import { OutboundError, type OutboundCode } from './errors.ts';
import { LIMITS, type Limits } from './limits.ts';
import { RedirectLedger } from './redirects.ts';

declare module 'node:http' {
  // Node.js calls this for every request, but its types leave it out.
  interface Agent {
    addRequest(req: ClientRequest, options: ClientRequestArgs): void;
  }
}

const isIdentity = (encoding: string | string[]): boolean =>
  typeof encoding === 'string' && encoding.toLowerCase() === 'identity';

/** Redirects are counted across all agents, so a request made with `agent: false` is counted too. */
const sharedLedger = new RedirectLedger();

export class OutboundHttpAgent extends HttpAgent {
  override createConnection(
    _options: ClientRequestArgs,
    callback?: (error: Error | null, stream: Duplex) => void,
  ): undefined {
    callback?.(new OutboundError('scheme_refused'), undefined as unknown as Duplex);
    return undefined;
  }
}

export interface OutboundHttpsAgentOptions {
  resolve?: Resolve;
  /** Opens the TLS connection to the address that was checked. Tests replace it. */
  connect?: (options: ConnectionOptions) => TLSSocket;
  limits?: Limits;
  ledger?: RedirectLedger;
}

type RequestOptions = ClientRequestArgs;

export class OutboundHttpsAgent extends HttpsAgent {
  readonly #resolve: Resolve;
  readonly #connect: (options: ConnectionOptions) => TLSSocket;
  readonly #limits: Limits;
  readonly #ledger: RedirectLedger;

  constructor(options: OutboundHttpsAgentOptions = {}) {
    super({ keepAlive: false });
    this.#resolve = options.resolve ?? systemResolve;
    this.#connect = options.connect ?? tlsConnect;
    this.#limits = options.limits ?? LIMITS;
    this.#ledger = options.ledger ?? sharedLedger;
  }

  override createConnection(
    options: RequestOptions,
    callback?: (error: Error | null, stream: Duplex) => void,
  ): undefined {
    const host = options.host ?? '';
    const { port } = options;
    if (options.method === 'CONNECT' || options.socketPath !== undefined) {
      callback?.(new OutboundError('method_refused'), undefined as unknown as Duplex);
      return undefined;
    }
    let socket: TLSSocket | undefined;
    let done = false;
    const finish = (error: Error | null, connected?: TLSSocket): void => {
      if (!done) callback?.(error, connected as Duplex);
      done = true;
    };
    // One limit for resolving, connecting and the TLS handshake.
    const timer = setTimeout(() => {
      const error = new OutboundError('timeout');
      if (socket === undefined) finish(error);
      else socket.destroy(error);
    }, this.#limits.connectMs).unref();
    const clear = (): void => {
      clearTimeout(timer);
    };
    // The caller's own checkServerIdentity must not weaken the host name check.
    const caller: ConnectionOptions = { ...(options as ConnectionOptions) };
    delete caller.checkServerIdentity;
    checkedAddress(host, this.#resolve)
      .then((address) => {
        if (done) return;
        socket = this.#connect({
          ...caller,
          host: address,
          port: Number(port),
          servername: serverName(host),
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
        });
        socket.once('secureConnect', clear).once('close', clear);
        finish(null, socket);
      })
      .catch((error: unknown) => {
        clear();
        finish(error as Error);
      });
    return undefined;
  }

  override addRequest(req: ClientRequest, options: RequestOptions): void {
    this.#limit(req, options);
    if (!req.headersSent) req.setHeader('accept-encoding', 'identity');
    super.addRequest(req, options);
  }

  /**
   * Time, redirect and size limits for one request. The checks run before any
   * listener of the caller does: a response that fails them is never emitted,
   * and no chunk over the limit is ever pushed to a reader.
   */
  #limit(req: ClientRequest, options: RequestOptions): void {
    const host = options.host ?? '';
    const url = new URL(
      req.path,
      `https://${isIPv6(host) ? `[${host}]` : host}:${String(options.port)}`,
    );
    const depth = this.#ledger.enter(url);
    const { maxBodyBytes } = this.#limits;
    let refused = false;
    const abort = (code: OutboundCode, res?: IncomingMessage): void => {
      refused = true;
      const error = new OutboundError(code);
      res?.destroy(error);
      req.destroy(error);
    };
    const total = setTimeout(abort, this.#limits.totalMs, 'timeout').unref();
    const headers = setTimeout(abort, this.#limits.headersMs, 'timeout').unref();
    req.once('close', () => {
      clearTimeout(total);
      clearTimeout(headers);
    });
    const emit = req.emit.bind(req) as (event: string | symbol, ...args: unknown[]) => boolean;
    req.emit = (event: string | symbol, ...args: unknown[]) => {
      if (event !== 'response') return emit(event, ...args);
      const res = args[0] as IncomingMessage;
      clearTimeout(headers);
      try {
        if (refused) throw new OutboundError('timeout');
        // Compressed bytes could expand far past the limit in a caller's decoder.
        const encoding = res.headers['content-encoding'] as string | string[] | undefined;
        if (req.method !== 'HEAD' && encoding !== undefined && !isIdentity(encoding)) {
          throw new OutboundError('encoding_refused');
        }
        const length = Number(res.headers['content-length']);
        if (req.method !== 'HEAD' && length > maxBodyBytes) {
          throw new OutboundError('body_too_large');
        }
        this.#ledger.follow(url, depth, res.statusCode ?? 0, res.headers.location);
      } catch (error) {
        abort((error as OutboundError).code, res);
        // Nothing is emitted, so Node.js drains the response itself.
        return false;
      }
      let bytes = 0;
      const push = res.push.bind(res) as (chunk: unknown, encoding?: BufferEncoding) => boolean;
      res.push = (chunk, encoding) => {
        bytes += chunk === null ? 0 : Buffer.byteLength(chunk as Uint8Array, encoding);
        if (bytes <= maxBodyBytes) return push(chunk, encoding);
        abort('body_too_large', res);
        return false;
      };
      return emit(event, ...args);
    };
  }
}
