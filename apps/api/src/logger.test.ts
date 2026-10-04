// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClassificationRegistry } from '@pixel-scientists/db/classification';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { captureLogs } from '../test/support.ts';
import { Secret } from './config.ts';
import { createLogger } from './logger.ts';
import { CENSOR } from './redaction.ts';
import { SafeError } from './serialize-error.ts';

function logger(registry?: ClassificationRegistry) {
  const logs = captureLogs();
  return { logs, log: createLogger({ level: 'debug', destination: logs.stream, registry }) };
}

describe('log lines', () => {
  it('are JSON, with a level name, an ISO time, the service and a message', () => {
    const { logs, log } = logger();
    log.info({ programmeId: '0c7c3d1e-6c4e-4f4e-9d52-0e0a8d2c9a11' }, 'Programme opened');

    const [line] = logs.lines();
    expect(line).toMatchObject({
      level: 'info',
      service: 'tps-api',
      msg: 'Programme opened',
      programmeId: '0c7c3d1e-6c4e-4f4e-9d52-0e0a8d2c9a11',
    });
    expect(String(line?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('respect the configured level', () => {
    const logs = captureLogs();
    const log = createLogger({ level: 'warn', destination: logs.stream });
    log.info('not written');
    log.warn('written');
    expect(logs.lines().map((line) => line.msg)).toEqual(['written']);
  });
});

describe('credentials', () => {
  it('are censored in the authorisation, cookie and set-cookie headers wherever they appear', () => {
    const { logs, log } = logger();
    log.info({
      headers: {
        authorization: 'Bearer SECRET-TOKEN',
        Cookie: 'session=SECRET-COOKIE',
        'set-cookie': ['session=SECRET-SET-COOKIE; HttpOnly'],
        'Proxy-Authorization': 'Basic SECRET-PROXY',
        accept: 'application/json',
      },
      response: { headers: { 'Set-Cookie': 'session=SECRET-RESPONSE' } },
      nested: { deeper: { headers: { authorization: 'Bearer SECRET-DEEP' } } },
    });

    expect(logs.text()).not.toContain('SECRET');
    expect(logs.lines()[0]).toMatchObject({
      headers: {
        authorization: CENSOR,
        Cookie: CENSOR,
        'set-cookie': CENSOR,
        accept: 'application/json',
      },
    });
  });

  it('are censored whatever their compound name', () => {
    const { logs, log } = logger();
    log.info({
      password: 'SECRET-PASSWORD',
      smtpPassword: 'SECRET-SMTP',
      reset_token: 'SECRET-RESET',
      csrfToken: 'SECRET-CSRF',
      form: { clientSecret: 'SECRET-CLIENT', secretAccessKey: 'SECRET-KEY', otp: 'SECRET-OTP' },
      backupCode: 'SECRET-BACKUP',
    });
    expect(logs.text()).not.toContain('SECRET');
  });

  it('are censored when held in a Secret from the configuration', () => {
    const { logs, log } = logger();
    log.info({ database: { host: 'db.internal', password: new Secret('SECRET-DB') } });
    expect(logs.text()).not.toContain('SECRET-DB');
    expect(logs.lines()[0]).toMatchObject({ database: { host: 'db.internal' } });
  });
});

describe('personal data', () => {
  it('is censored by name wherever it appears, whatever its spelling', () => {
    const { logs, log } = logger();
    log.info({
      applicant: {
        id: '0c7c3d1e-6c4e-4f4e-9d52-0e0a8d2c9a11',
        profile: {
          email: 'jo.bloggs@example.org',
          first_name: 'Jo',
          'Last-Name': 'Bloggs',
          phoneNumber: '07700 900123',
          date_of_birth: '1980-01-01',
        },
      },
      people: [{ emailAddress: 'sam@example.org' }],
      answers: { f_0a1b: 'A private answer' },
    });

    const text = logs.text();
    for (const personal of ['jo.bloggs', 'Bloggs', '07700', '1980', 'sam@', 'private answer']) {
      expect(text).not.toContain(personal);
    }
    expect(logs.lines()[0]).toMatchObject({
      applicant: { id: '0c7c3d1e-6c4e-4f4e-9d52-0e0a8d2c9a11' },
    });
  });

  it('is censored when the classification map marks a column personal or special category', () => {
    const tenantLifetime = { kind: 'tenant_lifetime' } as const;
    const { logs, log } = logger({
      'app.applicant_profile': {
        employer_name: { sensitivity: 'personal', retention: tenantLifetime },
        health_notes: { sensitivity: 'special_category', retention: tenantLifetime },
        programme_title: { sensitivity: 'public', retention: tenantLifetime },
        status: { sensitivity: 'internal', retention: tenantLifetime },
      },
    });
    log.info({
      employerName: 'Acme Ltd',
      health_notes: 'Needs step-free access',
      programmeTitle: 'Open call',
      status: 'draft',
    });

    expect(logs.lines()[0]).toMatchObject({
      employerName: CENSOR,
      health_notes: CENSOR,
      programmeTitle: 'Open call',
      status: 'draft',
    });
  });
});

describe('errors', () => {
  const databaseError = Object.assign(
    new Error('invalid input syntax for type uuid: "jane@example.com"'),
    {
      severity: 'ERROR',
      code: '22P02',
      detail: 'Key (email)=(jane@example.com) already exists.',
      where: 'SQL statement "INSERT ... jane@example.com"',
      parameters: ['jane@example.com'],
    },
  );

  it('are logged without the values they were built with, in the field and in the message', () => {
    const { logs, log } = logger();
    log.error({ err: databaseError }, 'Insert failed');
    log.error({ err: databaseError });
    log.error(databaseError);
    log.error({ failure: databaseError, applicant: { email: 'jane@example.com' } }, 'Again');

    expect(logs.text()).not.toContain('jane@example.com');
    expect(logs.text()).not.toContain('invalid input syntax');
    const [first, second, third, fourth] = logs.lines();
    expect(first).toMatchObject({
      msg: 'Insert failed',
      err: { type: 'Error', code: '22P02', message: 'database error 22P02' },
    });
    expect(first?.['err']).toHaveProperty('stack');
    expect(second).toMatchObject({ msg: 'database error 22P02' });
    expect(third).toMatchObject({ msg: 'database error 22P02', err: { code: '22P02' } });
    expect(fourth).toMatchObject({ failure: { code: '22P02' } });
  });

  it('are logged without a thrown string', () => {
    const { logs, log } = logger();
    log.error({ err: 'jane@example.com' }, 'Thrown');
    expect(logs.text()).not.toContain('jane@example.com');
    expect(logs.lines()[0]).toMatchObject({ err: { message: 'A string was thrown. Length: 16.' } });
  });

  it('are logged without their message, which can quote input', () => {
    const { logs, log } = logger();
    let parseError: unknown;
    try {
      JSON.parse('jane@example.com');
    } catch (error) {
      parseError = error;
    }
    log.error({ err: parseError }, 'Could not read the body');
    log.error({ err: parseError });
    log.error(parseError);

    expect(logs.text()).not.toContain('jane@example.com');
    const lines = logs.lines();
    expect(lines[0]).toMatchObject({ err: { type: 'SyntaxError', message: 'SyntaxError' } });
    expect(lines[1]).toMatchObject({ msg: 'SyntaxError' });
    expect(lines[2]).toMatchObject({ msg: 'SyntaxError' });
  });

  it('give a message of their own to whatever is logged as err, whether or not it is an error', () => {
    const { logs, log } = logger();
    const foreign: unknown = runInNewContext('new TypeError("jane@example.com")');
    log.error({ err: foreign });
    log.error({ err: { message: 'jane@example.com' } });
    log.error({ err: 'jane@example.com' });

    expect(logs.text()).not.toContain('jane@example.com');
    expect(logs.lines().map((line) => line.msg)).toEqual([
      'TypeError',
      'A non-error was thrown.',
      'A string was thrown. Length: 16.',
    ]);
  });

  it('keep the message of an error we wrote ourselves', () => {
    const { logs, log } = logger();
    log.error({ err: new SafeError('The round is closed.') });
    expect(logs.lines()[0]).toMatchObject({
      msg: 'The round is closed.',
      err: { message: 'The round is closed.' },
    });
  });
});

describe('child loggers', () => {
  it('censor the fields added later with setBindings, on a child and on its children', () => {
    const { logs, log } = logger();
    const child = log.child({ applicationId: 'a1' });
    child.setBindings({ email: 'jane@example.com', applicantPhone: '07700 900123' });
    const grandchild = child.child({ clientIp: '203.0.113.9' });
    grandchild.setBindings({ csrfToken: 'SECRET', programmeId: 'p1' });
    grandchild.info('Hello');

    for (const secret of ['jane@example.com', '07700', '203.0.113.9', 'SECRET']) {
      expect(logs.text()).not.toContain(secret);
    }
    expect(logs.lines()[0]).toMatchObject({
      applicationId: 'a1',
      email: CENSOR,
      applicantPhone: CENSOR,
      clientIp: CENSOR,
      csrfToken: CENSOR,
      programmeId: 'p1',
    });
  });

  it('cannot bring their own formatters, which would replace the redaction', () => {
    const { logs, log } = logger();
    const formatters = { log: (object: object) => object };

    expect(() => log.child({ applicationId: 'a1' }, { formatters })).toThrow(
      'A child logger cannot change how its fields are redacted.',
    );
    expect(() => log.child({}, { formatters: undefined })).toThrow('cannot change');
    expect(logs.text()).toBe('');
  });

  it('can still be made with other options', () => {
    const { logs, log } = logger();
    log.child({ applicationId: 'a1' }, { msgPrefix: 'review: ' }).info('Hello');
    expect(logs.lines()[0]).toMatchObject({ applicationId: 'a1', msg: 'review: Hello' });
  });

  it('censor the fields they are made with', () => {
    const { logs, log } = logger();
    const child = log.child({
      email: 'jane@example.com',
      csrfToken: 'SECRET',
      applicationId: 'a1',
    });
    child.info('Hello');

    expect(logs.text()).not.toContain('jane@example.com');
    expect(logs.text()).not.toContain('SECRET');
    expect(logs.lines()[0]).toMatchObject({
      email: CENSOR,
      csrfToken: CENSOR,
      applicationId: 'a1',
    });
  });

  it('log an error given to them without its values', () => {
    const { logs, log } = logger();
    const failure = Object.assign(
      new Error('invalid input syntax for type uuid: "jane@example.com"'),
      {
        severity: 'ERROR',
        code: '22P02',
      },
    );
    log.child({ requestId: 'r1' }).error(failure);

    expect(logs.text()).not.toContain('jane@example.com');
    expect(logs.lines()[0]).toMatchObject({ requestId: 'r1', msg: 'database error 22P02' });
  });
});
