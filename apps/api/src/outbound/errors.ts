// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one error an outbound refusal raises (ADR 0010). The message is fixed
// for each code and carries nothing of the request: no URL, host, path,
// query, address or header. It is a SafeError, so a log line shows the
// message and code and nothing else.

import { SafeError } from '../serialize-error.ts';

const MESSAGES = {
  scheme_refused: 'An outbound request must use HTTPS.',
  method_refused: 'An outbound request may not upgrade or tunnel the connection.',
  address_refused: 'An outbound request may only reach public internet addresses.',
  unresolvable: 'The host of an outbound request could not be resolved.',
  redirect_refused: 'An outbound request was redirected somewhere it may not go.',
  too_many_redirects: 'An outbound request was redirected too many times.',
  body_too_large: 'The response to an outbound request was too large.',
  encoding_refused: 'The response to an outbound request was compressed.',
  destination_refused: 'A client for a fixed destination was asked to reach another one.',
  timeout: 'An outbound request took too long.',
} as const;

export type OutboundCode = keyof typeof MESSAGES;

export class OutboundError extends SafeError {
  readonly code: OutboundCode;

  constructor(code: OutboundCode) {
    super(MESSAGES[code]);
    this.name = 'OutboundError';
    this.code = code;
  }
}
