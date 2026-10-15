// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sends through the real transport to Mailpit, the development mail server
// (infra/compose/compose.dev.yaml), and reads the message back through its
// API. The test is skipped when Mailpit is not running.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import { afterAll, describe, expect, it } from 'vitest';

import { captureLogs } from '../../test/support.ts';
import { isLoopbackHost, Secret, type SmtpSettings } from '../config.ts';
import { createLogger } from '../logger.ts';
import { createSender } from './sender.ts';
import { createSmtpTransport } from './transport.ts';

/** Mailpit's inbox and API, as the Compose file publishes them. */
const MAILPIT_API = `${process.env['TPS_MAILPIT_URL'] ?? 'http://127.0.0.1:58025'}/api/v1`;

const PRINT_SETTINGS =
  'const e = process.env; console.log(JSON.stringify([e.TPS_SMTP_HOST, e.TPS_SMTP_PORT, ' +
  'e.TPS_SMTP_TLS, e.TPS_SMTP_USER, e.TPS_SMTP_PASSWORD, e.TPS_SMTP_FROM]))';

interface MailpitMessage {
  Subject: string;
  Text: string;
  HTML: string;
  From: { Address: string };
  To: { Address: string }[];
}

/**
 * The mail settings `pnpm dev` gives the API (scripts/dev-env.ts), or
 * undefined when Mailpit or Docker is not there, or when a local override
 * points the settings at anything but plain SMTP to a loopback address: the
 * test must never log in to a real relay.
 */
async function developmentMail(): Promise<SmtpSettings | undefined> {
  try {
    const response = await fetch(`${MAILPIT_API}/info`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return undefined;
    const printed = execFileSync(
      process.execPath,
      ['scripts/dev-env.ts', 'api', 'node', '-e', PRINT_SETTINGS],
      {
        cwd: new URL('../../../../', import.meta.url),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const [host, port, tls, user, password, from] = JSON.parse(printed) as (string | null)[];
    if (!host || !port || !user || !password || !from) return undefined;
    if (tls !== 'none' || isIP(host) === 0 || !isLoopbackHost(host)) return undefined;
    return {
      host,
      port: Number(port),
      tls: 'none',
      from,
      auth: { user, password: new Secret(password) },
    };
  } catch {
    return undefined;
  }
}

async function mailpit<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_API}${path}`);
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

const smtp = await developmentMail();
const created: string[] = [];

afterAll(async () => {
  if (created.length === 0) return;
  await fetch(`${MAILPIT_API}/messages`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IDs: created }),
  });
});

describe.skipIf(smtp === undefined)('sending to Mailpit', () => {
  it('delivers plain text in UTF-8 to the right recipient with the right subject', async () => {
    if (smtp === undefined) return;
    const logs = captureLogs();
    const sender = createSender(
      smtp,
      createLogger({ level: 'info', destination: logs.stream }),
      createSmtpTransport(smtp),
    );
    // Mailpit is shared between worktrees, so the recipient is unique to this run.
    const to = `ada-${randomUUID()}@example.com`;
    const subject = 'Résultat: 100 £ ✓';

    await expect(sender.send({ to, subject, text: 'Zoë ✓\nSecond line' })).resolves.toEqual({
      sent: true,
    });

    const found = await mailpit<{ messages: { ID: string }[] }>(
      `/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    expect(found.messages).toHaveLength(1);
    const id = found.messages[0]?.ID ?? '';
    created.push(id);
    const message = await mailpit<MailpitMessage>(`/message/${id}`);
    expect(message.To.map((address) => address.Address)).toEqual([to]);
    expect(message.From.Address).toBe(smtp.from);
    expect(message.Subject).toBe(subject);
    expect(message.Text.replaceAll('\r\n', '\n').trim()).toBe('Zoë ✓\nSecond line');
    expect(message.HTML).toBe('');
    expect(logs.text()).toBe('');
  });
});
