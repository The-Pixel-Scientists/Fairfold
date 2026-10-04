// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../../test/support.ts';
import { createLogger } from '../logger.ts';
import {
  createSender,
  EMAIL_FAILURE_CODES,
  failureCode,
  type EmailFailureCode,
  type MailMessage,
  type MailTransport,
} from './sender.ts';

const settings = { from: 'grants@example.org' };

function setup(deliver: MailTransport['deliver'] = () => Promise.resolve()) {
  const logs = captureLogs();
  const logger = createLogger({ level: 'info', destination: logs.stream });
  const transport = { deliver: vi.fn(deliver) };
  return { sender: createSender(settings, logger, transport), transport, logs };
}

const email = { to: 'ada@example.com', subject: 'Your sign-in link', text: 'Hello, Ada.' };

function clientError(code: string, command = 'RCPT TO'): Error {
  return Object.assign(new Error('550 5.1.1 <ada@example.com> User unknown, secret text'), {
    code,
    command,
  });
}

describe('send', () => {
  it('sends plain text from the configured address', async () => {
    const { sender, transport } = setup();

    await expect(sender.send({ ...email, to: 'Ada@Example.com' })).resolves.toEqual({ sent: true });
    expect(transport.deliver).toHaveBeenCalledExactlyOnceWith({
      from: 'grants@example.org',
      to: 'Ada@Example.com',
      subject: 'Your sign-in link',
      text: 'Hello, Ada.',
    } satisfies MailMessage);
  });

  it('passes a subject and text in UTF-8 unchanged', async () => {
    const { sender, transport } = setup();

    await sender.send({ ...email, subject: 'Résultat: 100 £', text: 'Zoë ✓\nSecond line' });
    expect(transport.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Résultat: 100 £', text: 'Zoë ✓\nSecond line' }),
    );
  });

  it.each([
    ['a line break in the subject', { subject: 'Hi\r\nBcc: spy@example.net' }],
    ['a bare line feed in the subject', { subject: 'Hi\nBcc: spy@example.net' }],
    ['a Unicode line separator in the subject', { subject: 'Hi Bcc: spy@example.net' }],
    ['a null in the subject', { subject: 'Hi\0' }],
    ['a line break in the address', { to: 'ada@example.com\r\nBcc: spy@example.net' }],
    ['a trailing line break in the address', { to: 'ada@example.com\n' }],
    ['a leading space in the address', { to: ' ada@example.com' }],
    ['two addresses', { to: 'ada@example.com, spy@example.net' }],
    ['a display name', { to: 'Ada <ada@example.com>' }],
    ['no address', { to: '' }],
    ['an address that is not one', { to: 'ada' }],
    ['an empty subject', { subject: '' }],
    ['a very long subject', { subject: 'x'.repeat(201) }],
    ['an empty body', { text: '' }],
    ['a very long body', { text: 'x'.repeat(100_001) }],
  ])('refuses %s before it connects', async (_name, change) => {
    const { sender, transport } = setup();

    await expect(sender.send({ ...email, ...change })).resolves.toEqual({
      sent: false,
      code: 'invalid_message',
    });
    expect(transport.deliver).not.toHaveBeenCalled();
  });

  it.each<[string, string, EmailFailureCode]>([
    ['a timeout', 'ETIMEDOUT', 'timeout'],
    ['a refused connection', 'ECONNECTION', 'connection_failed'],
    ['a dropped socket', 'ESOCKET', 'connection_failed'],
    ['a failed login', 'EAUTH', 'auth_failed'],
    ['a refused recipient', 'EENVELOPE', 'recipient_refused'],
    ['a refused message', 'EMESSAGE', 'rejected'],
    ['a TLS failure', 'ETLS', 'tls_failed'],
    ['a certificate that does not verify', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_failed'],
    ['an unknown failure', 'EWHATEVER', 'failed'],
  ])('answers with a code for %s, and does not throw', async (_name, code, expected) => {
    const { sender } = setup(() => Promise.reject(clientError(code)));

    await expect(sender.send(email)).resolves.toEqual({ sent: false, code: expected });
  });

  it('answers with a code when the client throws something that is not an error', async () => {
    const { sender } = setup(() => Promise.reject(new Error('plain')));
    await expect(sender.send(email)).resolves.toEqual({ sent: false, code: 'failed' });
    expect(failureCode('text')).toBe('failed');
    expect(failureCode(null)).toBe('failed');
  });

  it('refuses a rejected sender address as rejected, not as a refused recipient', () => {
    expect(failureCode(clientError('EENVELOPE', 'MAIL FROM'))).toBe('rejected');
  });

  it('only ever answers with a code from the closed list', () => {
    for (const code of ['ETIMEDOUT', 'EAUTH', 'EENVELOPE', 'EMESSAGE', 'ETLS', 'ESOCKET', 'x']) {
      expect(EMAIL_FAILURE_CODES).toContain(failureCode(clientError(code)));
    }
  });

  it('logs the code and the request id, and nothing about the email or the error', async () => {
    const { sender, logs } = setup(() => Promise.reject(clientError('EENVELOPE')));

    await sender.send({ ...email, requestId: 'req-123' });
    await sender.send({ ...email, subject: 'Bad\nsubject', requestId: 'req-456' });

    expect(logs.lines()).toEqual([
      expect.objectContaining({ level: 'warn', code: 'recipient_refused', requestId: 'req-123' }),
      expect.objectContaining({ level: 'warn', code: 'invalid_message', requestId: 'req-456' }),
    ]);
    const text = logs.text();
    for (const secret of ['ada@example.com', 'sign-in link', 'Hello, Ada', 'User unknown', 'Bad']) {
      expect(text).not.toContain(secret);
    }
  });
});
