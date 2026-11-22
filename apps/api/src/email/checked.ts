// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way to send a module's email to a person (ADR 0033). Inside the
// caller's tenant transaction it asks party whether the person may be
// contacted for this kind of message, reads the address from party, and only
// then sends; a marketing message carries the one-click unsubscribe headers
// and a transactional one carries none. A refusal sends nothing and answers
// with a skip code, a list of its own so a report can tell "not allowed"
// from "failed". Anything the check cannot tell is refused or failed, never
// sent. This only reads: it records no consent, suppression or decision. The
// caller records the answer on its outbox row. Logs carry codes and the
// request id only.

import type { Transaction } from '@pixel-scientists/db';
import type {
  MayContact,
  MayContactInput,
  MessageKind,
  SkipCode,
} from '@pixel-scientists/party/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { EmailFailureCode, Sender } from './sender.ts';
import { addressHash, type SuppressionKeys } from './suppression-hash.ts';
import { signUnsubscribeToken, type UnsubscribeKeys } from './unsubscribe-token.ts';

type Tx = Transaction<unknown>;

export interface CheckedDependencies {
  readonly sender: Sender;
  readonly logger: FastifyBaseLogger;
  readonly keys: UnsubscribeKeys;
  /** Hash the recipient's address into the unsubscribe token; the secret is the lead's setting. */
  readonly suppressionKeys: SuppressionKeys;
  /** The applicant portal's origin, which an unsubscribe link goes to. */
  readonly portalOrigin: string;
  /** Party's server contract: the check, and the address with its tenant. */
  readonly contact: {
    mayContact(tx: Tx, input: MayContactInput): Promise<MayContact>;
    emailRecipient(tx: Tx, personId: string): Promise<{ tenantId: string; address: string } | null>;
  };
}

export interface CheckedMessage {
  readonly personId: string;
  readonly message: MessageKind;
  readonly subject: string;
  readonly text: string;
  readonly requestId?: string;
}

export type CheckedResult =
  | { sent: true }
  | { sent: false; skipped: true; code: SkipCode }
  | { sent: false; skipped: false; code: EmailFailureCode };

export function createCheckedSender(deps: CheckedDependencies) {
  return async function sendChecked(tx: Tx, input: CheckedMessage): Promise<CheckedResult> {
    const { requestId } = input;
    const skip = (code: SkipCode): CheckedResult => {
      deps.logger.info({ code, requestId }, 'An email was not allowed');
      return { sent: false, skipped: true, code };
    };
    const failed = (): CheckedResult => {
      deps.logger.warn({ code: 'failed', requestId }, 'An email was not sent');
      return { sent: false, skipped: false, code: 'failed' };
    };

    let recipient;
    try {
      const allowed = await deps.contact.mayContact(tx, {
        personId: input.personId,
        channel: 'email',
        message: input.message,
      });
      if (!allowed.allowed) return skip(allowed.code);
      recipient = await deps.contact.emailRecipient(tx, input.personId);
    } catch {
      return failed();
    }
    if (recipient === null) return skip('no_contact_point');

    let unsubscribe;
    if (input.message.kind === 'marketing') {
      try {
        unsubscribe = {
          origin: deps.portalOrigin,
          token: signUnsubscribeToken(deps.keys, {
            tenantId: recipient.tenantId,
            personId: input.personId,
            purpose: input.message.purpose,
            channel: 'email',
            address: addressHash(deps.suppressionKeys, recipient.tenantId, recipient.address),
          }),
        };
      } catch {
        return failed();
      }
    }
    const sent = await deps.sender.send({
      to: recipient.address,
      subject: input.subject,
      text: input.text,
      ...(unsubscribe === undefined ? {} : { unsubscribe }),
      ...(requestId === undefined ? {} : { requestId }),
    });
    return sent.sent ? sent : { sent: false, skipped: false, code: sent.code };
  };
}

export type SendChecked = ReturnType<typeof createCheckedSender>;
