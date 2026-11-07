// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The emails of an email change (ADR 0010, "Accounts"). The link goes only
// to the new address; an address that already has an account is told how to
// sign in instead, never who asked. Once a change commits, the old address
// is told when, with no link and not the new address, and the new one gets
// a confirmation. All are sent after the response, and a failed send never
// undoes anything: the sender logs its failure code alone.

import { productName } from '@pixel-scientists/domain/platform';

import type { RouteDependencies } from '../routes.ts';

export interface EmailText {
  readonly subject: string;
  readonly text: string;
}

const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const email = (subject: string, ...paragraphs: string[]): EmailText => ({
  subject,
  text: paragraphs.join('\n\n'),
});

/** To the new address, which has no account: the link to confirm it. */
export const confirmText = (link: string) =>
  email(
    `Confirm your new email address for ${productName}`,
    `You asked to sign in to your ${productName} account with this email address.`,
    'To confirm it, open this link within 1 hour:',
    link,
    'The link works once. If you did not ask for this, ignore this email. Nobody can use your email address without this link.',
  );

/** To the new address, which already has an account: how to use it instead. */
export const takenText = (base: string) =>
  email(
    `You already have a ${productName} account`,
    `Someone asked to use this email address for a ${productName} account. It already has an account, so nothing was changed.`,
    `To sign in, go to:\n${base}/sign-in`,
    `If you have forgotten your password, reset it here:\n${base}/forgot-password`,
    'If you did not ask for this, ignore this email. Your account has not changed.',
  );

/** To the old address, once the change commits. */
export const changedText = (at: Date) =>
  email(
    `The email address for your ${productName} account was changed`,
    `The email address you sign in to ${productName} with was changed on ${when.format(at)} UTC. This address can no longer be used to sign in, and your other sessions were signed out.`,
    'If you did not do this, tell the organisation you work with or apply to straight away. They will ask the service operator to return your account to you.',
  );

/** To the new address, once the change commits. */
export const confirmedText = () =>
  email(
    `Your ${productName} email address has changed`,
    `You now sign in to ${productName} with this email address. Your other sessions were signed out.`,
  );

/** Email `to`, or log that no sender is set. Run it after the response. */
export async function send(
  deps: Pick<RouteDependencies, 'sender' | 'log'>,
  requestId: string,
  to: string,
  message: EmailText,
): Promise<void> {
  if (deps.sender === undefined) {
    deps.log.error({ requestId }, 'No mail sender is set: an email change email was not sent');
    return;
  }
  await deps.sender.send({ to, ...message, requestId });
}
