// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sends plain-text email through the configured mail server, for the auth
// emails now and release emails later (ADR 0020). A delivery failure is an
// answer with a code, never a thrown error, and a log line carries the code
// and the request id only: not the recipient, subject, text or error message.
//
// The SMTP client itself is behind MailTransport. The implementation
// (transport.ts, with the dependency S02-02 pins) is not built yet, so
// nothing here connects anywhere. It must pin the host and port, verify the
// certificate, use no proxy and set time limits (ADR 0010) before the API
// sends real mail.

import { emailSchema } from '@pixel-scientists/domain/auth';
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
    return errorCommand(error) === 'MAIL FROM' ? 'rejected' : 'recipient_refused';
  }
  if (code === 'EMESSAGE') return 'rejected';
  if (code === 'ETLS' || /^(ERR_TLS|ERR_SSL|CERT_)/.test(code) || /CERT|SELF_SIGNED/.test(code)) {
    return 'tls_failed';
  }
  if (CONNECTION_ERRORS.has(code)) return 'connection_failed';
  return 'failed';
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
    email.text.length <= MAX_TEXT_LENGTH
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
      try {
        await transport.deliver({
          from: settings.from,
          to: email.to,
          subject: email.subject,
          text: email.text,
        });
        return { sent: true };
      } catch (error) {
        return fail(failureCode(error));
      }
    },
  };
}
