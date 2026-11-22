// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Grants' route into the platform's consent-checked send path (ADR 0033).
// The purpose is read from the template version fixed on the outbox row,
// never the latest version, so a later edit cannot turn a service email into
// marketing or back. Marketing goes through the check with its consent
// purpose; a service email goes through it as transactional. A version that
// is missing, or whose purpose is not on the list, sends nothing. This only
// reads: it changes no application, decision, consent or suppression.
// Release, reminder and message emails keep calling the sender as they do.

import type { MessageKind, SkipCode } from '@pixel-scientists/party/contracts';

import type { DecisionEmailErrorCode } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

/** The platform's checked send, which the API's wiring supplies. */
export type SendChecked = (
  tx: Tx,
  input: {
    readonly personId: string;
    readonly message: MessageKind;
    readonly subject: string;
    readonly text: string;
    readonly requestId?: string;
  },
) => Promise<
  | { readonly sent: true }
  | { readonly sent: false; readonly skipped: true; readonly code: SkipCode }
  | { readonly sent: false; readonly skipped: false; readonly code: DecisionEmailErrorCode }
>;

/** Grants' marketing mail is for this consent purpose until another is added. */
const MARKETING: MessageKind = { kind: 'marketing', purpose: 'future_funding' };

export interface TemplateEmail {
  readonly templateVersionId: string;
  readonly personId: string;
  readonly subject: string;
  readonly text: string;
  readonly requestId?: string;
}

export function sendTemplateEmail(sendChecked: SendChecked) {
  return async (tx: Tx, email: TemplateEmail): ReturnType<SendChecked> => {
    const version = await tx
      .$extendTables<{ 'grants.email_template_version': { id: string; purpose: string } }>()
      .selectFrom('grants.email_template_version')
      .select('purpose')
      .where('id', '=', email.templateVersionId)
      .executeTakeFirst();
    const message =
      version?.purpose === 'marketing'
        ? MARKETING
        : version?.purpose === 'transactional'
          ? ({ kind: 'transactional' } as const)
          : undefined;
    if (message === undefined) return { sent: false, skipped: false, code: 'invalid_message' };
    return sendChecked(tx, {
      personId: email.personId,
      message,
      subject: email.subject,
      text: email.text,
      ...(email.requestId === undefined ? {} : { requestId: email.requestId }),
    });
  };
}
