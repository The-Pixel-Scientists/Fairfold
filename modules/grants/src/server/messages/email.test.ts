// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messageEmail } from './email.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('messageEmail', () => {
  it('says a message is waiting and links to the thread, with the given name only', () => {
    const email = messageEmail({
      givenName: 'Ada',
      portalOrigin: 'https://portal.example.org',
      applicationId: ID,
    });

    expect(email.subject).toBe('You have a new message about your application');
    expect(email.text).toContain('Dear Ada,');
    expect(email.text).toContain(`https://portal.example.org/applications/${ID}/messages`);
  });

  it('addresses an applicant with no given name as the applicant', () => {
    for (const givenName of [null, '']) {
      const { text } = messageEmail({
        givenName,
        portalOrigin: 'https://portal.example.org',
        applicationId: ID,
      });
      expect(text).toContain('Dear applicant,');
    }
  });

  it('takes no message text, so none can reach the subject or text', () => {
    expect(messageEmail.length).toBe(1);
    const email = messageEmail({
      givenName: 'Ada',
      portalOrigin: 'https://portal.example.org',
      applicationId: ID,
    });
    expect(JSON.stringify(email)).not.toMatch(/Synthetic/);
  });
});
