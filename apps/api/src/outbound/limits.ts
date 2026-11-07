// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The fixed limits on every outbound request (ADR 0010). Tests pass smaller
// ones to the factories; the installed dispatcher and agents take none.

export interface Limits {
  /** Resolving the host and opening the connection, TLS included. */
  readonly connectMs: number;
  /** From the start of the request to the response headers. */
  readonly headersMs: number;
  /** From the start of the request to the end of the body. */
  readonly totalMs: number;
  /** The response body, in bytes. */
  readonly maxBodyBytes: number;
}

export const LIMITS: Limits = {
  connectMs: 5_000,
  headersMs: 10_000,
  totalMs: 30_000,
  maxBodyBytes: 1024 * 1024,
};

/** Redirects followed for one request. A fourth is refused. */
export const MAX_REDIRECTS = 3;
