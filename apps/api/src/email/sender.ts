// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sends plain-text email through the configured mail server, for the auth
// emails now and release emails later (ADR 0020). A delivery failure is an
// answer with a code, never a thrown error, and a log line carries the code
// and the request id only: not the recipient, subject, text or error message.
//
// The SMTP client itself is behind MailTransport (transport.ts).

import { apiBasePath } from '@pixel-scientists/domain/api';
import { emailSchema } from '@pixel-scientists/domain/auth';
import { confirmUnsubscribe, unsubscribeTokenSchema } from '@pixel-scientists/party/contracts';
import type { FastifyBaseLogger } from 'fastify';

import { hasControlCharacter, type SmtpSettings } from '../config.ts';

export const EMAIL_FAILURE_CODES = [
  'invalid_message',
  'connection_failed',
  'tls_failed',
  'timeout',
  'auth_failed',
  'rejected',
  'recipient_refused',
  'failed',
] as const;
export type EmailFailureCode = (typeof EMAIL_FAILURE_CODES)[number];

export type SendResult = { sent: true } | { sent: false; code: EmailFailureCode };

export interface Email {
  /** One address. It must pass `emailSchema` and hold no line break. */
  to: string;
  subject: string;
  text: string;
  /**
   * Marketing only: adds the RFC 8058 one-click unsubscribe headers. The sender builds their
   * values from a token of the strict character set and an https origin; no other header
   * can be added.
   */
  unsubscribe?: { origin: string; token: string };
  /** Goes on the log line of a failure, so support can match it to the request. */
  requestId?: string;
}

export interface Sender {
  send(email: Email): Promise<SendResult>;
}

/** A message ready for the mail server. Plain text in UTF-8; nothing else can be sent. */
export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** The one https link of the List-Unsubscribe header; the transport adds both headers. */
  unsubscribeUrl?: string;
}

/** Delivers one message, or throws the SMTP client's error. */
export interface MailTransport {
  deliver(message: MailMessage): Promise<void>;
}

const MAX_SUBJECT_LENGTH = 200;
const MAX_TEXT_LENGTH = 100_000;

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : '';
}

function errorCommand(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const { command } = error as { command?: unknown };
  return typeof command === 'string' ? command : '';
}

const CONNECTION_ERRORS = new Set([
  'ECONNECTION',
  'ESOCKET',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'EDNS',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** Map an SMTP client's error to a code. The error's message is never used. */
export function failureCode(error: unknown): EmailFailureCode {
  const code = errorCode(error);
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code === 'EAUTH') return 'auth_failed';
  if (code === 'EENVELOPE') {
    return errorCommand(error) === 'RCPT TO' ? 'recipient_refused' : 'rejected';
  }
  if (code === 'EMESSAGE') return 'rejected';
  if (code === 'ETLS' || /^(ERR_TLS|ERR_SSL|CERT_)/.test(code) || /CERT|SELF_SIGNED/.test(code)) {
    return 'tls_failed';
  }
  if (CONNECTION_ERRORS.has(code)) return 'connection_failed';
  return 'failed';
}

/** A body may hold line feeds and tabs. A bare carriage return could end the message early at a relay (SMTP smuggling). */
function isSafeBody(text: string): boolean {
  return !hasControlCharacter(text.replaceAll('\n', '').replaceAll('\t', ''));
}

/**
 * The unsubscribe link, on the API's path: a mail provider POSTs to it, and the edge sends only
 * `/api/` to the API. Undefined if the origin is not a bare https origin or the token is not valid.
 */
function unsubscribeUrl(unsubscribe: NonNullable<Email['unsubscribe']>): string | undefined {
  const { origin, token } = unsubscribe;
  if (hasControlCharacter(origin) || !unsubscribeTokenSchema.safeParse(token).success) {
    return undefined;
  }
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) return undefined;
    return `${origin}${apiBasePath}${confirmUnsubscribe.path}?token=${token}`;
  } catch {
    return undefined;
  }
}

function isSendable(email: Email): boolean {
  return (
    !hasControlCharacter(email.to) &&
    email.to === email.to.trim() &&
    emailSchema.safeParse(email.to).success &&
    email.subject !== '' &&
    email.subject.length <= MAX_SUBJECT_LENGTH &&
    !hasControlCharacter(email.subject) &&
    email.text !== '' &&
    email.text.length <= MAX_TEXT_LENGTH &&
    isSafeBody(email.text)
  );
}

export function createSender(
  settings: Pick<SmtpSettings, 'from'>,
  logger: FastifyBaseLogger,
  transport: MailTransport,
): Sender {
  return {
    async send(email) {
      const requestId = email.requestId;
      const fail = (code: EmailFailureCode): SendResult => {
        logger.warn({ code, requestId }, 'An email was not sent');
        return { sent: false, code };
      };
      // Checked before connecting, on the raw values: emailSchema trims, and a
      // trailing line break must not pass as an address.
      if (!isSendable(email)) return fail('invalid_message');
      const link = email.unsubscribe === undefined ? undefined : unsubscribeUrl(email.unsubscribe);
      if (email.unsubscribe !== undefined && link === undefined) return fail('invalid_message');
      try {
        await transport.deliver({
          from: settings.from,
          to: email.to,
          subject: email.subject,
          text: email.text,
          ...(link === undefined ? {} : { unsubscribeUrl: link }),
        });
        return { sent: true };
      } catch (error) {
        return fail(failureCode(error));
      }
    },
  };
}
