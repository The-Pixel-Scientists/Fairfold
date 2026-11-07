// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The emails that tell a user their sign-in changed (ADR 0010, "Accounts"):
// sent after the change commits, with the time and no link, so a notice
// can never act for anyone. A failed send never undoes the change; the
// sender logs its failure code.

import { productName } from '@pixel-scientists/domain/platform';

import type { RouteDependencies } from '../routes.ts';

export type AccountNotice = 'totp_changed' | 'totp_removed' | 'password_changed';

const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** The subject and paragraphs of a notice of a change at `at`. */
export function noticeText(notice: AccountNotice, at: Date): { subject: string; text: string } {
  const time = `${when.format(at)} UTC`;
  const ifNotYou =
    'If you did not do this, reset your password from the sign-in page now and tell the organisation you work with or apply to.';
  const texts: Record<AccountNotice, readonly [subject: string, happened: string]> = {
    totp_changed: [
      `The authenticator app for your ${productName} account was changed`,
      `A new authenticator app was set up for your ${productName} account on ${time}, and you were signed out everywhere. Use the new app when you sign in.`,
    ],
    totp_removed: [
      `The authenticator app was removed from your ${productName} account`,
      `The authenticator app was removed from your ${productName} account on ${time}, and you were signed out everywhere.`,
    ],
    password_changed: [
      `Your ${productName} password was changed`,
      `The password for your ${productName} account was changed on ${time}. Your other sessions were signed out.`,
    ],
  };
  const [subject, happened] = texts[notice];
  return { subject, text: [happened, ifNotYou].join('\n\n') };
}

/** Email `to` the notice after the response. */
export function sendNotice(
  deps: Pick<RouteDependencies, 'later' | 'sender' | 'log'>,
  requestId: string,
  to: string,
  notice: AccountNotice,
): void {
  const at = new Date();
  deps.later(async () => {
    if (deps.sender === undefined) {
      deps.log.error(
        { requestId, notice },
        'No mail sender is set: an account notice was not sent',
      );
      return;
    }
    await deps.sender.send({ to, ...noticeText(notice, at), requestId });
  });
}
