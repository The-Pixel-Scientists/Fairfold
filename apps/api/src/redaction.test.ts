// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClassificationRegistry } from '@pixel-scientists/db/classification';
import { describe, expect, it } from 'vitest';

import { Secret } from './config.ts';
import { CENSOR, redactLogObject, sensitiveKeyMatcher } from './redaction.ts';

const tenantLifetime = { kind: 'tenant_lifetime' } as const;

const registry: ClassificationRegistry = {
  'app.applicant_profile': {
    employer_name: { sensitivity: 'personal', retention: tenantLifetime },
    health_notes: { sensitivity: 'special_category', retention: tenantLifetime },
    programme_title: { sensitivity: 'public', retention: tenantLifetime },
    status: { sensitivity: 'internal', retention: tenantLifetime },
  },
};

describe('sensitiveKeyMatcher', () => {
  const isSensitive = sensitiveKeyMatcher({});

  it('matches a key whatever its case or punctuation', () => {
    for (const key of ['first_name', 'firstName', 'First-Name', 'FIRST NAME']) {
      expect(isSensitive(key)).toBe(true);
    }
  });

  it('matches a key that contains the name of a credential', () => {
    for (const key of [
      'authorization',
      'Proxy-Authorization',
      'set-cookie',
      'password',
      'smtpPassword',
      'dbPassword',
      'passwd',
      'passphrase',
      'token',
      'csrfToken',
      'apiToken',
      'verificationToken',
      'x-api-key',
      'secret',
      'authSecret',
      'secretAccessKey',
      'accessKeyId',
      'privateKey',
      'clientCredentials',
      'requestSignature',
      'idJwt',
      'samlAssertion',
      'bearer',
      'x-goog-iap-jwt-assertion',
    ]) {
      expect(isSensitive(key), key).toBe(true);
    }
  });

  it('matches one-time codes and session ids as words, not inside other words', () => {
    for (const key of [
      'otp',
      'totp',
      'backupCode',
      'recovery_code',
      'sessionId',
      'userSessionId',
    ]) {
      expect(isSensitive(key), key).toBe(true);
    }
    for (const key of ['hotpants', 'code', 'session', 'requestId']) {
      expect(isSensitive(key), key).toBe(false);
    }
  });

  it('matches where a caller is and where they came from, with any prefix', () => {
    for (const key of [
      'ip',
      'clientIp',
      'clientIP',
      'remoteIp',
      'IPAddress',
      'ipAddress',
      'remoteAddress',
      'x-forwarded-for',
      'x-real-ip',
      'cf-connecting-ip',
      'true-client-ip',
      'x-client-ip',
      'forwarded',
      'referer',
      'referrer',
      'user-agent',
      'from',
      'From',
    ]) {
      expect(isSensitive(key), key).toBe(true);
    }
  });

  it('matches personal data with any prefix or suffix', () => {
    for (const key of [
      'email',
      'userEmail',
      'applicantEmail',
      'x-goog-authenticated-user-email',
      'contactPhone',
      'phoneNumber',
      'date_of_birth',
      'homePostcode',
      'answers',
      'body',
      'requestBody',
    ]) {
      expect(isSensitive(key), key).toBe(true);
    }
  });

  it('does not match a personal word inside another word', () => {
    for (const key of ['relationship', 'zip', 'ship', 'skip', 'validFrom', 'fromStatus']) {
      expect(isSensitive(key), key).toBe(false);
    }
  });

  it('matches the columns the classification map marks personal or special category', () => {
    const withMap = sensitiveKeyMatcher(registry);
    expect(withMap('employerName')).toBe(true);
    expect(withMap('health_notes')).toBe(true);
    expect(withMap('previousEmployerName')).toBe(true);
  });

  it('leaves out public and internal columns, and generic words', () => {
    const withMap = sensitiveKeyMatcher(registry);
    for (const key of ['programmeTitle', 'status', 'name', 'code', 'state', 'id', 'type', '']) {
      expect(withMap(key), key).toBe(false);
    }
  });

  it('reads the shipped classification map when none is given', () => {
    expect(sensitiveKeyMatcher()('authorization')).toBe(true);
  });
});

describe('redactLogObject', () => {
  const isSensitive = sensitiveKeyMatcher(registry);

  it('censors a sensitive key at any depth, whatever its spelling', () => {
    const output = redactLogObject(
      {
        applicant: {
          id: '0c7c3d1e-6c4e-4f4e-9d52-0e0a8d2c9a11',
          profile: { first_name: 'Jo', 'Last-Name': 'Bloggs', employerName: 'Acme Ltd' },
        },
        people: [{ emailAddress: 'sam@example.org' }],
        email: 'jo.bloggs@example.org',
        smtp: { smtpPassword: 'hunter2' },
      },
      isSensitive,
      [],
    );

    expect(output).toEqual({
      applicant: {
        id: '0c7c3d1e-6c4e-4f4e-9d52-0e0a8d2c9a11',
        profile: { first_name: CENSOR, 'Last-Name': CENSOR, employerName: CENSOR },
      },
      people: [{ emailAddress: CENSOR }],
      email: CENSOR,
      smtp: { smtpPassword: CENSOR },
    });
  });

  it('censors a whole subtree under a sensitive key', () => {
    const output = redactLogObject(
      { answers: { f_0a1b: 'A private answer', f_2c3d: 4 } },
      isSensitive,
      [],
    );
    expect(output).toEqual({ answers: CENSOR });
  });

  it('leaves the keys the logger serialises itself for its own serialisers', () => {
    const request = { headers: { cookie: 'session=abc' } };
    const output = redactLogObject(
      { req: request, other: { cookie: 'session=abc' } },
      isSensitive,
      ['req'],
    );
    expect(output['req']).toBe(request);
    expect(output['other']).toEqual({ cookie: CENSOR });
  });

  it('does not change what it was given', () => {
    const input = { profile: { email: 'jo@example.org' } };
    redactLogObject(input, isSensitive, []);
    expect(input.profile.email).toBe('jo@example.org');
  });

  it('describes an error found in the object, without the values it was built with', () => {
    const failure = Object.assign(
      new Error('invalid input syntax for type uuid: "jo@example.org"'),
      {
        severity: 'ERROR',
        code: '22P02',
      },
    );
    const output = redactLogObject({ failure }, isSensitive, []);
    expect(JSON.stringify(output)).not.toContain('jo@example.org');
    expect(output['failure']).toMatchObject({ message: 'database error 22P02' });
  });

  it('copes with cycles and with objects nested deeper than it reads', () => {
    const cyclic: Record<string, unknown> = { id: 'a' };
    cyclic['self'] = cyclic;
    let deep: Record<string, unknown> = { end: true };
    for (let level = 0; level < 20; level += 1) deep = { child: deep };

    const output = JSON.stringify(redactLogObject({ cyclic, deep }, isSensitive, []));
    expect(output).toContain('[circular]');
    expect(output).toContain('[truncated]');
  });

  it('does not mistake an object that appears twice for a cycle', () => {
    const shared = { id: 'a' };
    expect(redactLogObject({ first: shared, second: shared }, isSensitive, [])).toEqual({
      first: { id: 'a' },
      second: { id: 'a' },
    });
  });

  describe('an object that writes itself', () => {
    it('is a Secret censored, and a Date left as it is', () => {
      const date = new Date('2026-10-02T12:00:00Z');
      const output = redactLogObject({ at: date, held: new Secret('hunter2') }, isSensitive, []);
      expect(output['at']).toBe(date);
      expect(output['held']).toBe(CENSOR);
    });

    it('is redacted as what it writes', () => {
      const applicant = { toJSON: () => ({ id: 'a', email: 'jo@example.org' }) };
      const output = redactLogObject({ applicant, list: [applicant] }, isSensitive, []);
      expect(output).toEqual({
        applicant: { id: 'a', email: CENSOR },
        list: [{ id: 'a', email: CENSOR }],
      });
    });

    it('is walked as it is when it writes itself', () => {
      const self = { id: 'a', email: 'jo@example.org', toJSON: () => self };
      expect(JSON.stringify(redactLogObject({ self }, isSensitive, []))).not.toContain('jo@');
    });

    it('does not loop when two objects write each other', () => {
      const a: { toJSON: () => unknown } = { toJSON: () => b };
      const b: { toJSON: () => unknown } = { toJSON: () => a };
      expect(JSON.stringify(redactLogObject({ a }, isSensitive, []))).toContain('[circular]');
    });
  });
});
