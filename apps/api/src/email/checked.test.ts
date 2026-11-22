// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';
import type { MayContact } from '@pixel-scientists/party/contracts';
import { describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../../test/support.ts';
import { createLogger } from '../logger.ts';
import { createCheckedSender, type CheckedMessage } from './checked.ts';
import type { Email, SendResult } from './sender.ts';
import { addressHash, suppressionKeys } from './suppression-hash.ts';
import { unsubscribeKeys, verifyUnsubscribeToken } from './unsubscribe-token.ts';

const keys = unsubscribeKeys(new Map([[1, 'a-secret-of-at-least-thirty-two-characters']]), 1);
const hashKeys = suppressionKeys(new Map([[2, 'a-suppression-secret-of-at-least-32-chars']]), 2);
const tx = {} as Transaction<unknown>;
const tenantId = randomUUID();
const personId = randomUUID();
const marketing = { kind: 'marketing', purpose: 'future_funding' } as const;
const message = (kind: CheckedMessage['message']): CheckedMessage => ({
  personId,
  message: kind,
  subject: 'News from the fund',
  text: 'Hello.',
  requestId: 'request-1',
});

function setup(
  answer: MayContact | Error = { allowed: true },
  recipient: { tenantId: string; address: string } | null = {
    tenantId,
    address: 'ada@example.com',
  },
  result: SendResult = { sent: true },
) {
  const logs = captureLogs();
  const send = vi.fn<(email: Email) => Promise<SendResult>>(() => Promise.resolve(result));
  const mayContact = vi.fn(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  );
  const emailRecipient = vi.fn(() => Promise.resolve(recipient));
  const sendChecked = createCheckedSender({
    sender: { send },
    logger: createLogger({ level: 'info', destination: logs.stream }),
    keys,
    suppressionKeys: hashKeys,
    portalOrigin: 'https://portal.example.org',
    contact: { mayContact, emailRecipient },
  });
  return { sendChecked, send, mayContact, emailRecipient, logs };
}

describe('sendChecked for marketing', () => {
  it.each(['no_consent', 'consent_withdrawn', 'suppressed', 'person_erased'] as const)(
    'sends nothing and answers %s when party refuses',
    async (code) => {
      const { sendChecked, send, emailRecipient, logs } = setup({ allowed: false, code });

      expect(await sendChecked(tx, message(marketing))).toEqual({
        sent: false,
        skipped: true,
        code,
      });
      expect(send).not.toHaveBeenCalled();
      expect(emailRecipient).not.toHaveBeenCalled();
      expect(logs.text()).toContain(code);
      expect(logs.text()).not.toContain('ada@example.com');
    },
  );

  it('asks about the person and purpose it sends, in the caller transaction', async () => {
    const { sendChecked, mayContact } = setup();

    await sendChecked(tx, message(marketing));
    expect(mayContact).toHaveBeenCalledExactlyOnceWith(tx, {
      personId,
      channel: 'email',
      message: marketing,
    });
  });

  it('sends to the address party holds with a token for that tenant and person', async () => {
    const { sendChecked, send } = setup();

    expect(await sendChecked(tx, message(marketing))).toEqual({ sent: true });
    const email = send.mock.calls[0]?.[0];
    expect(email).toMatchObject({ to: 'ada@example.com', requestId: 'request-1' });
    expect(email?.unsubscribe?.origin).toBe('https://portal.example.org');
    expect(verifyUnsubscribeToken(keys, email?.unsubscribe?.token ?? '')).toEqual({
      tenantId,
      personId,
      purpose: 'future_funding',
      channel: 'email',
      address: addressHash(hashKeys, tenantId, 'ada@example.com'),
    });
  });

  it('fails closed when the address cannot be hashed, and sends nothing', async () => {
    const { sendChecked, send } = setup(
      { allowed: true },
      { tenantId: 'not-an-id', address: 'a@b.co' },
    );

    expect(await sendChecked(tx, message(marketing))).toEqual({
      sent: false,
      skipped: false,
      code: 'failed',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a person with no address', async () => {
    const { sendChecked, send } = setup({ allowed: true }, null);

    expect(await sendChecked(tx, message(marketing))).toEqual({
      sent: false,
      skipped: true,
      code: 'no_contact_point',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed when the check fails, and logs a code only', async () => {
    const { sendChecked, send, logs } = setup(new Error('connection to db at 10.0.0.1 failed'));

    expect(await sendChecked(tx, message(marketing))).toEqual({
      sent: false,
      skipped: false,
      code: 'failed',
    });
    expect(send).not.toHaveBeenCalled();
    expect(logs.text()).not.toContain('10.0.0.1');
  });

  it('answers a delivery failure with its own code, apart from the skip codes', async () => {
    const { sendChecked } = setup({ allowed: true }, undefined, { sent: false, code: 'timeout' });

    expect(await sendChecked(tx, message(marketing))).toEqual({
      sent: false,
      skipped: false,
      code: 'timeout',
    });
  });
});

describe('sendChecked for a transactional message', () => {
  it('sends with no unsubscribe headers', async () => {
    const { sendChecked, send, mayContact } = setup();

    expect(await sendChecked(tx, message({ kind: 'transactional' }))).toEqual({ sent: true });
    expect(mayContact).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ message: { kind: 'transactional' } }),
    );
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('unsubscribe');
  });

  it('is still refused for an erased person', async () => {
    const { sendChecked, send } = setup({ allowed: false, code: 'person_erased' });

    expect(await sendChecked(tx, message({ kind: 'transactional' }))).toMatchObject({
      sent: false,
      code: 'person_erased',
    });
    expect(send).not.toHaveBeenCalled();
  });
});
