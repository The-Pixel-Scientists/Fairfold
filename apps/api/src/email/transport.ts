// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The SMTP client behind MailTransport (ADR 0010). It connects to the
// configured host and port and nowhere else, verifies the server's
// certificate, uses no proxy, and gives up after a time limit at each stage.
// Nothing is logged here: the SMTP client's logs hold addresses and text.

import { createTransport } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import type { SmtpSettings } from '../config.ts';
import type { MailMessage, MailTransport } from './sender.ts';

export interface SmtpTimeouts {
  /** Opening the connection. */
  readonly connectionMs: number;
  /** The server's first line after it connects. */
  readonly greetingMs: number;
  /** Silence from the server once talking. */
  readonly socketMs: number;
}

export const SMTP_TIMEOUTS: SmtpTimeouts = {
  connectionMs: 10_000,
  greetingMs: 10_000,
  socketMs: 30_000,
};

export function smtpOptions(
  settings: SmtpSettings,
  timeouts: SmtpTimeouts = SMTP_TIMEOUTS,
): SMTPTransport.Options {
  return {
    host: settings.host,
    port: settings.port,
    // starttls: upgrade or fail. tls: encrypted from the first byte. none: never upgrade.
    secure: settings.tls === 'tls',
    requireTLS: settings.tls === 'starttls',
    ignoreTLS: settings.tls === 'none',
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    ...(settings.auth === undefined
      ? {}
      : { auth: { user: settings.auth.user, pass: settings.auth.password.reveal() } }),
    connectionTimeout: timeouts.connectionMs,
    greetingTimeout: timeouts.greetingMs,
    socketTimeout: timeouts.socketMs,
    // The message is made of the fields given, never of a file or an address on the network.
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}

/**
 * The SMTP client reports two failures without a code that tells them apart:
 * a connection closed before the greeting carries none, and a TLS failure
 * on a socket arrives as ESOCKET. Name them for failureCode(); the message is
 * read here to decide and is never logged.
 */
function withCode(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const { code } = error as { code?: unknown };
  if (code === undefined && error.message === 'Unexpected socket close') {
    return Object.assign(error, { code: 'ECONNECTION' });
  }
  if (code === 'ESOCKET' && /certificate|self[- ]signed|ssl|tls/i.test(error.message)) {
    return Object.assign(error, { code: 'ETLS' });
  }
  return error;
}

export function createSmtpTransport(
  settings: SmtpSettings,
  timeouts: SmtpTimeouts = SMTP_TIMEOUTS,
): MailTransport {
  const transporter = createTransport(smtpOptions(settings, timeouts));
  return {
    async deliver(message: MailMessage): Promise<void> {
      try {
        // The envelope names the one recipient, whatever the headers hold.
        await transporter.sendMail({
          ...message,
          envelope: { from: message.from, to: [message.to] },
        });
      } catch (error) {
        throw withCode(error);
      }
    },
  };
}
