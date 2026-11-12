// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The email that says a message is waiting (ADR 0033). It is fixed text: the
// applicant's given name and a link to their thread are the only values, so
// no message text, subject line, staff name or answer can reach it.

export interface MessageEmail {
  readonly subject: string;
  readonly text: string;
}

export function messageEmail(values: {
  readonly givenName: string | null;
  readonly portalOrigin: string;
  readonly applicationId: string;
}): MessageEmail {
  const name =
    values.givenName === null || values.givenName === '' ? 'applicant' : values.givenName;
  const link = `${values.portalOrigin}/applications/${encodeURIComponent(values.applicationId)}/messages`;
  return {
    subject: 'You have a new message about your application',
    text: [
      `Dear ${name},`,
      '',
      'The funder has sent you a message about your application.',
      '',
      'Sign in to read it and reply:',
      link,
      '',
      'We do not put the message in this email, to keep it private.',
    ].join('\n'),
  };
}
