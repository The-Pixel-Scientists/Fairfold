// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The undici dispatcher behind every `fetch` (ADR 0010). It refuses anything
// but HTTPS, connects only to an address that passed the address policy,
// follows no more than 3 redirects, and refuses a response over 1 MB. It asks
// for no compression, because `fetch` would decompress above this point, and
// refuses a response that arrives compressed anyway. No trace context is
// added to the request.

import type { IncomingHttpHeaders } from 'node:http';

import { Agent, buildConnector, type Dispatcher } from 'undici';

import { checkedAddress, serverName, systemResolve, type Resolve } from './connect.ts';
import { OutboundError, type OutboundCode } from './errors.ts';
import { LIMITS, type Limits } from './limits.ts';
import { RedirectLedger } from './redirects.ts';

export interface OutboundDispatcherOptions {
  /** How host names are resolved. The system resolver when left out. */
  resolve?: Resolve;
  /** Opens the connection to the address that was checked. Tests replace it. */
  connector?: buildConnector.connector;
  limits?: Limits;
}

type Handler = Dispatcher.DispatchHandler;
type Controller = Dispatcher.DispatchController;
type Check = (status: number, headers: IncomingHttpHeaders) => void;

const TIMEOUT_CODES: ReadonlySet<unknown> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** The request headers, in whichever form undici is given them, asking for no compression. */
function uncompressed(headers: unknown): unknown[] {
  const flat = Array.isArray(headers)
    ? (headers as unknown[])
    : Object.entries((headers ?? {}) as Record<string, unknown>).flat();
  const kept: unknown[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    if (String(flat[i]).toLowerCase() !== 'accept-encoding') kept.push(flat[i], flat[i + 1]);
  }
  return [...kept, 'accept-encoding', 'identity'];
}

const isIdentity = (encoding: string | string[]): boolean =>
  typeof encoding === 'string' && encoding.toLowerCase() === 'identity';

/** Wraps the caller's handler to check the response as it arrives. */
class ResponseGuard implements Handler {
  readonly #inner: Handler;
  readonly #check: Check;
  readonly #limits: Limits;
  #bytes = 0;
  #timer: NodeJS.Timeout | undefined;

  constructor(inner: Handler, limits: Limits, check: Check) {
    this.#inner = inner;
    this.#limits = limits;
    this.#check = check;
  }

  onRequestStart(controller: Controller, context: unknown): void {
    this.#timer = setTimeout(() => {
      controller.abort(new OutboundError('timeout'));
    }, this.#limits.totalMs).unref();
    this.#inner.onRequestStart?.(controller, context);
  }

  onResponseStart(
    controller: Controller,
    status: number,
    headers: IncomingHttpHeaders,
    message?: string,
  ): void {
    try {
      this.#check(status, headers);
    } catch (error) {
      controller.abort(error as Error);
      return;
    }
    this.#inner.onResponseStart?.(controller, status, headers, message);
  }

  onResponseData(controller: Controller, chunk: Buffer): void {
    this.#bytes += chunk.length;
    if (this.#bytes > this.#limits.maxBodyBytes) {
      controller.abort(new OutboundError('body_too_large'));
      return;
    }
    this.#inner.onResponseData?.(controller, chunk);
  }

  onResponseEnd(controller: Controller, trailers: Record<string, string | string[]>): void {
    clearTimeout(this.#timer);
    this.#inner.onResponseEnd?.(controller, trailers);
  }

  onResponseError(controller: Controller, error: Error): void {
    clearTimeout(this.#timer);
    const code = (error as { code?: unknown }).code;
    this.#inner.onResponseError?.(
      controller,
      TIMEOUT_CODES.has(code) ? new OutboundError('timeout') : error,
    );
  }

  onResponseStarted(): void {
    this.#inner.onResponseStarted?.();
  }

  onBodySent(chunk: Buffer): void {
    this.#inner.onBodySent?.(chunk);
  }

  onRequestSent(): void {
    this.#inner.onRequestSent?.();
  }
}

/** The interceptor: refuses what it must before dispatch, and guards the response. */
function guard(limits: Limits): Dispatcher.DispatchInterceptor {
  const ledger = new RedirectLedger();
  return (dispatch) => (opts, handler) => {
    const refuse = (code: OutboundCode): false => {
      handler.onResponseError?.(null as never, new OutboundError(code));
      return false;
    };
    // The connection goes to the origin, so its scheme decides. A path that is
    // itself a URL (absolute, or starting `//`) could hide a different one.
    const origin = opts.origin === undefined ? null : URL.parse(String(opts.origin));
    if (origin?.protocol !== 'https:' || !/^\/(?![/\\])/.test(opts.path)) {
      return refuse('scheme_refused');
    }
    const url = new URL(opts.path, origin);
    if (Boolean(opts.upgrade) || opts.method === 'CONNECT') return refuse('method_refused');

    const depth = ledger.enter(url);
    const bodyless = opts.method === 'HEAD';
    const check: Check = (status, headers) => {
      // Repeated headers arrive as arrays, which are never the plain form.
      const encoding = headers['content-encoding'] as string | string[] | undefined;
      const length = Number(headers['content-length']);
      if (!bodyless && encoding !== undefined && !isIdentity(encoding)) {
        throw new OutboundError('encoding_refused');
      }
      if (!bodyless && length > limits.maxBodyBytes) throw new OutboundError('body_too_large');
      ledger.follow(url, depth, status, headers['location']);
    };
    return dispatch(
      { ...opts, headers: uncompressed(opts.headers) as never },
      new ResponseGuard(handler, limits, check),
    );
  };
}

export function createOutboundDispatcher(options: OutboundDispatcherOptions = {}): Dispatcher {
  const { resolve = systemResolve, limits = LIMITS } = options;
  const connector =
    options.connector ??
    buildConnector({
      timeout: limits.connectMs,
      allowH2: false,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
  const connect: buildConnector.connector = (target, callback) => {
    const { hostname } = target;
    if (target.protocol !== 'https:') {
      callback(new OutboundError('scheme_refused'), null);
      return;
    }
    checkedAddress(hostname, resolve).then(
      (address) => {
        connector({ ...target, hostname: address, servername: serverName(hostname) }, callback);
      },
      (error: unknown) => {
        callback(error as Error, null);
      },
    );
  };
  return new Agent({
    connect,
    headersTimeout: limits.headersMs,
    bodyTimeout: limits.totalMs,
  }).compose(guard(limits));
}
