// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closedPort, startStub, type Stub, type StubOptions } from '../../test/smtp-stub.ts';
import { captureLogs } from '../../test/support.ts';
import { Secret, type SmtpSettings } from '../config.ts';
import { createLogger } from '../logger.ts';
import { createSender, type EmailFailureCode } from './sender.ts';
import { createSmtpTransport, smtpOptions, SMTP_TIMEOUTS, type SmtpTimeouts } from './transport.ts';

const email = { to: 'ada@example.com', subject: 'Your sign-in link', text: 'Hello, Ada.' };
const fast: SmtpTimeouts = { connectionMs: 500, greetingMs: 300, socketMs: 300 };
const login = { auth: { user: 'mailer', password: new Secret('pw') } };

const settings = (port: number, change: Partial<SmtpSettings> = {}): SmtpSettings => ({
  host: '127.0.0.1',
  port,
  tls: 'none',
  from: 'grants@example.org',
  ...change,
});

const stubs: Stub[] = [];
afterEach(async () => {
  await Promise.all(stubs.splice(0).map((stub) => stub.close()));
});

async function stub(options?: StubOptions): Promise<Stub> {
  const started = await startStub(options);
  stubs.push(started);
  return started;
}

function setup(smtp: SmtpSettings, timeouts = fast) {
  const logs = captureLogs();
  const logger = createLogger({ level: 'info', destination: logs.stream });
  return { sender: createSender(smtp, logger, createSmtpTransport(smtp, timeouts)), logs };
}

describe('smtpOptions', () => {
  const smtp = settings(2525, { tls: 'starttls', host: 'mail.example.org', ...login });

  it('pins the host and port, verifies the certificate, and sets all three time limits', () => {
    const options = smtpOptions(smtp);

    expect(options).toMatchObject({
      host: 'mail.example.org',
      port: 2525,
      requireTLS: true,
      secure: false,
      ignoreTLS: false,
      tls: { rejectUnauthorized: true },
      auth: { user: 'mailer', pass: 'pw' },
      connectionTimeout: SMTP_TIMEOUTS.connectionMs,
      greetingTimeout: SMTP_TIMEOUTS.greetingMs,
      socketTimeout: SMTP_TIMEOUTS.socketMs,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    for (const name of ['proxy', 'service', 'url', 'getSocket']) {
      expect(options).not.toHaveProperty(name);
    }
  });

  it('maps each TLS mode', () => {
    expect(smtpOptions({ ...smtp, tls: 'tls' })).toMatchObject({ secure: true, requireTLS: false });
    expect(smtpOptions({ ...smtp, tls: 'none' })).toMatchObject({ ignoreTLS: true, secure: false });
  });

  it('sends no login when none is set', () => {
    expect(smtpOptions(settings(25))).not.toHaveProperty('auth');
  });
});

describe('delivery to a stub server', () => {
  it('sends plain text in UTF-8 to one recipient', async () => {
    const server = await stub();
    const { sender, logs } = setup(settings(server.port));

    await expect(
      sender.send({ ...email, subject: 'Résultat: 100 £', text: 'Zoë ✓\nSecond line' }),
    ).resolves.toEqual({ sent: true });

    expect(server.messages).toHaveLength(1);
    const [message] = server.messages;
    expect(message?.from).toBe('grants@example.org');
    expect(message?.to).toEqual(['ada@example.com']);
    expect(message?.data).toMatch(/^Content-Type: text\/plain; charset=utf-8$/im);
    expect(message?.data).not.toMatch(/text\/html/i);
    expect(logs.text()).toBe('');
  });

  it('never puts an end-of-data marker inside the body, even when it is tried', async () => {
    const server = await stub();
    const { sender } = setup(settings(server.port));

    await expect(
      sender.send({ ...email, text: 'a\r.\r\nMAIL FROM:<spy@example.net>' }),
    ).resolves.toEqual({ sent: false, code: 'invalid_message' });
    expect(server.messages).toHaveLength(0);

    await expect(sender.send({ ...email, text: 'a\n.\nMAIL' })).resolves.toEqual({ sent: true });
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]?.data).not.toContain('\r.\r');
    expect(server.messages[0]?.data).not.toMatch(/\r(?!\n)/);
  });

  it('logs in when the settings carry a login', async () => {
    const server = await stub();
    const { sender } = setup(settings(server.port, login));

    await expect(sender.send(email)).resolves.toEqual({ sent: true });
  });

  it.each<[string, StubOptions, EmailFailureCode]>([
    ['a refused login', { refuse: 'AUTH' }, 'auth_failed'],
    ['a refused sender', { refuse: 'MAIL' }, 'rejected'],
    ['a refused recipient', { refuse: 'RCPT' }, 'recipient_refused'],
    ['a refused message', { refuse: 'DATA' }, 'rejected'],
    ['a server that drops the connection at once', { dropOnConnect: true }, 'connection_failed'],
    ['a server that drops the connection mid-session', { dropAt: 'MAIL' }, 'connection_failed'],
    ['a server that never greets', { silent: true }, 'timeout'],
    ['a server that stalls after the greeting', { stallAt: 'EHLO' }, 'timeout'],
    ['a server that stalls on the recipient', { stallAt: 'RCPT' }, 'timeout'],
  ])('answers with a code for %s', async (_name, options, code) => {
    const server = await stub(options);
    const { sender } = setup(settings(server.port, options.refuse === 'AUTH' ? login : {}));

    await expect(sender.send(email)).resolves.toEqual({ sent: false, code });
  });

  it('answers connection_failed when nothing is listening', async () => {
    const { sender } = setup(settings(await closedPort()));

    await expect(sender.send(email)).resolves.toEqual({ sent: false, code: 'connection_failed' });
  });

  it('refuses to send in clear when starttls is required and the server cannot upgrade', async () => {
    const server = await stub();
    const { sender } = setup(settings(server.port, { tls: 'starttls' }));

    await expect(sender.send(email)).resolves.toEqual({ sent: false, code: 'tls_failed' });
    expect(server.messages).toHaveLength(0);
  });

  it('logs the code and request id only, whatever the failure', async () => {
    const server = await stub({ refuse: 'RCPT' });
    const { sender, logs } = setup(settings(server.port, login));

    await sender.send({ ...email, requestId: 'req-1' });

    expect(logs.lines()).toEqual([
      expect.objectContaining({ level: 'warn', code: 'recipient_refused', requestId: 'req-1' }),
    ]);
    for (const secret of [
      'ada@example.com',
      'sign-in link',
      'Hello, Ada',
      'No such user',
      'mailer',
    ]) {
      expect(logs.text()).not.toContain(secret);
    }
  });
});

describe('certificate verification', () => {
  /** A throwaway certificate for 127.0.0.1, made for this test run. */
  function selfSigned(): { key: string; cert: string } | undefined {
    const folder = mkdtempSync(join(tmpdir(), 'tps-tls-'));
    const keyFile = join(folder, 'server-key');
    const certFile = join(folder, 'server-cert');
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=127.0.0.1',
        ].concat(['-keyout', keyFile, '-out', certFile]),
        { stdio: 'ignore' },
      );
      return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') };
    } catch {
      return undefined;
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  const tls = selfSigned();

  it.skipIf(tls === undefined)('refuses a server whose certificate is not trusted', async () => {
    const server = await stub({ ...(tls === undefined ? {} : { tls }) });
    const { sender } = setup(settings(server.port, { tls: 'starttls' }));

    await expect(sender.send(email)).resolves.toEqual({ sent: false, code: 'tls_failed' });
    expect(server.messages).toHaveLength(0);
  });
});
