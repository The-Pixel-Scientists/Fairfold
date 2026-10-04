// SPDX-License-Identifier: AGPL-3.0-or-later

import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, Secret, type Env } from './config.ts';

/** A complete, valid environment for a deployed API. */
const deployed: Env = {
  TPS_API_HOST: '0.0.0.0',
  TPS_API_PORT: '8080',
  TPS_DB_HOST: 'db.internal',
  TPS_DB_PORT: '5432',
  TPS_DB_NAME: 'tps',
  TPS_DB_TLS: 'verify-full',
  TPS_DB_APP_API_PASSWORD: 'a-long-random-password-for-tests',
  TPS_SMTP_HOST: 'smtp.internal',
  TPS_SMTP_PORT: '587',
  TPS_SMTP_TLS: 'starttls',
  TPS_SMTP_FROM: 'grants@example.org',
};

/** What `pnpm dev` supplies. */
const development: Env = {
  TPS_DEV: '1',
  TPS_API_PORT: '41000',
  TPS_DB_HOST: '127.0.0.1',
  TPS_DB_PORT: '55432',
  TPS_DB_NAME: 'tps_2026_w40',
  TPS_DB_APP_API_PASSWORD: 'dev-app-api-password-not-a-secret',
  TPS_SMTP_HOST: '127.0.0.1',
  TPS_SMTP_PORT: '51025',
  TPS_SMTP_TLS: 'none',
  TPS_SMTP_FROM: 'grants@example.org',
};

const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----\n';

const files: Record<string, string> = {
  '/run/secrets/app_api_password': 'password-from-a-mounted-file\n',
  '/run/secrets/db_ca': CERTIFICATE,
  '/run/secrets/empty': '',
};
const readFile = (path: string): string => {
  const content = files[path];
  if (content === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
  return content;
};

function without(env: Env, name: string): Env {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key !== name));
}

function problemsOf(env: Env): readonly string[] {
  try {
    loadConfig(env, readFile);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('Expected the configuration to be refused.');
}

describe('loadConfig', () => {
  it('reads a deployed configuration', () => {
    const config = loadConfig(deployed, readFile);
    expect(config).toMatchObject({
      development: false,
      logLevel: 'info',
      listen: { host: '0.0.0.0', port: 8080 },
      database: {
        host: 'db.internal',
        port: 5432,
        database: 'tps',
        tls: { mode: 'verify-full' },
      },
    });
    expect(config.database.password.reveal()).toBe('a-long-random-password-for-tests');
  });

  it('reads a development configuration and binds to loopback', () => {
    const config = loadConfig(development, readFile);
    expect(config.development).toBe(true);
    expect(config.listen).toEqual({ host: '127.0.0.1', port: 41000 });
    expect(config.database.tls).toBeUndefined();
  });

  it('names every variable that is missing, in one message', () => {
    expect(problemsOf({})).toEqual([
      'Set TPS_API_HOST.',
      'Set TPS_API_PORT.',
      'Set TPS_DB_HOST.',
      'Set TPS_DB_PORT.',
      'Set TPS_DB_NAME.',
      'Set TPS_DB_APP_API_PASSWORD or TPS_DB_APP_API_PASSWORD_FILE.',
    ]);
    expect(() => loadConfig({}, readFile)).toThrow(/^The API cannot start because/);
    expect(() => loadConfig({}, readFile)).toThrow('  - Set TPS_DB_NAME.');
  });

  it.each(['TPS_API_HOST', 'TPS_API_PORT', 'TPS_DB_HOST', 'TPS_DB_PORT', 'TPS_DB_NAME'])(
    'names %s when it is missing',
    (name) => {
      expect(problemsOf(without(deployed, name))).toEqual([`Set ${name}.`]);
    },
  );

  it('counts a variable set to an empty string as missing', () => {
    expect(problemsOf({ ...deployed, TPS_DB_NAME: '' })).toEqual(['Set TPS_DB_NAME.']);
  });

  it('does not need an address in development', () => {
    expect(problemsOf({ ...development, TPS_DB_HOST: '' })).toEqual(['Set TPS_DB_HOST.']);
    expect(loadConfig({ ...development, TPS_API_HOST: '::1' }, readFile).listen.host).toBe('::1');
  });

  it('refuses a public address in development', () => {
    expect(problemsOf({ ...development, TPS_API_HOST: '0.0.0.0' })).toEqual([
      'TPS_API_HOST must be a loopback address while TPS_DEV=1. ' +
        'Unset TPS_DEV to listen on another address.',
    ]);
  });

  it('refuses ports that are not port numbers', () => {
    for (const port of ['0', '65536', 'http', '-1', '80.5', '1e3', ' 80']) {
      expect(problemsOf({ ...deployed, TPS_API_PORT: port })).toEqual([
        'TPS_API_PORT must be a port number from 1 to 65535.',
      ]);
    }
  });

  it('refuses a database name that would need quoting or names a system database', () => {
    for (const name of ['Tps', 'tps-dev', '1pixel', 'a"; DROP', 'postgres', 'template1']) {
      expect(problemsOf({ ...deployed, TPS_DB_NAME: name })).toEqual([
        expect.stringMatching(/^TPS_DB_NAME must be 1 to 63 characters/) as string,
      ]);
    }
  });

  it('refuses a host that is not a host name or address', () => {
    expect(problemsOf({ ...deployed, TPS_DB_HOST: 'db host; x' })).toEqual([
      'TPS_DB_HOST must be a host name or an IP address.',
    ]);
  });

  it('accepts only 1 or unset for TPS_DEV', () => {
    expect(loadConfig({ ...deployed, TPS_DEV: '0' }, readFile).development).toBe(false);
    expect(problemsOf({ ...deployed, TPS_DEV: 'true' })).toEqual(['TPS_DEV must be 1, or unset.']);
  });

  it('checks the log level, and defaults to info', () => {
    expect(loadConfig({ ...deployed, TPS_LOG_LEVEL: 'debug' }, readFile).logLevel).toBe('debug');
    expect(problemsOf({ ...deployed, TPS_LOG_LEVEL: 'verbose' })).toEqual([
      'TPS_LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent.',
    ]);
  });
});

describe('trusted proxies', () => {
  const TRUST = 'TPS_API_TRUST_PROXY';

  it('trusts no proxy unless some are listed', () => {
    expect(loadConfig(deployed, readFile).trustProxy).toEqual([]);
  });

  it('reads a list of addresses and ranges', () => {
    const env = { ...deployed, [TRUST]: '10.0.0.0/8, 192.168.1.5,fd00::/8' };
    expect(loadConfig(env, readFile).trustProxy).toEqual(['10.0.0.0/8', '192.168.1.5', 'fd00::/8']);
  });

  it('refuses anything else, and a range that holds every address', () => {
    for (const value of [
      'true',
      '*',
      'proxy.internal',
      '10.0.0.0/0',
      '::/0',
      '10.0.0.0/33',
      '10.0.0.1,',
      '10.0.0.0/8/8',
    ]) {
      expect(problemsOf({ ...deployed, [TRUST]: value }), value).toEqual([
        expect.stringContaining(TRUST),
      ]);
    }
  });
});

describe('secrets', () => {
  const withoutPassword = without(deployed, 'TPS_DB_APP_API_PASSWORD');

  it('reads the password from the file named by NAME_FILE, without its final newline', () => {
    const config = loadConfig(
      {
        ...withoutPassword,
        TPS_DB_APP_API_PASSWORD_FILE: '/run/secrets/app_api_password',
      },
      readFile,
    );
    expect(config.database.password.reveal()).toBe('password-from-a-mounted-file');
  });

  it('refuses both NAME and NAME_FILE', () => {
    expect(
      problemsOf({
        ...deployed,
        TPS_DB_APP_API_PASSWORD_FILE: '/run/secrets/app_api_password',
      }),
    ).toEqual(['Set TPS_DB_APP_API_PASSWORD or TPS_DB_APP_API_PASSWORD_FILE, not both.']);
  });

  it('names the variable when its file cannot be read, without the path or the reason', () => {
    const problems = problemsOf({
      ...withoutPassword,
      TPS_DB_APP_API_PASSWORD_FILE: '/home/someone/secret-location',
    });
    expect(problems).toEqual(['TPS_DB_APP_API_PASSWORD_FILE names a file that cannot be read.']);
    expect(problems.join()).not.toContain('/home/someone');
    expect(problems.join()).not.toContain('ENOENT');
  });

  it('refuses a short password without repeating it', () => {
    const problems = problemsOf({ ...deployed, TPS_DB_APP_API_PASSWORD: 'short-secret' });
    expect(problems).toEqual(['TPS_DB_APP_API_PASSWORD must be at least 16 characters.']);
    expect(problems.join()).not.toContain('short-secret');
  });

  it('refuses a development password outside development', () => {
    const problems = problemsOf({
      ...deployed,
      TPS_DB_APP_API_PASSWORD: 'dev-app-api-password-not-a-secret',
    });
    expect(problems).toEqual([
      expect.stringMatching(/^TPS_DB_APP_API_PASSWORD is a development password/) as string,
    ]);
  });

  it('refuses a development password against a server that is not on this machine', () => {
    const problems = problemsOf({
      ...development,
      TPS_DB_HOST: 'db.internal',
      TPS_DB_TLS: 'verify-full',
    });
    expect(problems).toEqual([
      expect.stringMatching(/^TPS_DB_APP_API_PASSWORD is a development password/) as string,
    ]);
  });

  it('accepts a real password in development', () => {
    expect(
      loadConfig(
        { ...development, TPS_DB_APP_API_PASSWORD: 'a-long-random-password-for-tests' },
        readFile,
      ).development,
    ).toBe(true);
  });

  it('never writes a secret to JSON, a string or an inspected object', () => {
    const config = loadConfig(deployed, readFile);
    const password = 'a-long-random-password-for-tests';
    expect(JSON.stringify(config)).not.toContain(password);
    expect(String(config.database.password)).not.toContain(password);
    expect(inspect(config, { depth: 5 })).not.toContain(password);
    expect(new Secret(password).reveal()).toBe(password);
  });
});

describe('database TLS', () => {
  const withoutTls = without(deployed, 'TPS_DB_TLS');

  it('is required for a server that is not on this machine', () => {
    expect(problemsOf(withoutTls)).toEqual([
      expect.stringMatching(
        /^Set TPS_DB_TLS to verify-full, or to disable on a private network\./,
      ) as string,
    ]);
  });

  it('is not required for a server on this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      const config = loadConfig({ ...withoutTls, TPS_DB_HOST: host }, readFile);
      expect(config.database.tls).toBeUndefined();
    }
  });

  it('can be turned off, for a private network', () => {
    const config = loadConfig({ ...deployed, TPS_DB_TLS: 'disable' }, readFile);
    expect(config.database.tls).toEqual({ mode: 'disable' });
  });

  it('refuses any other mode', () => {
    expect(problemsOf({ ...deployed, TPS_DB_TLS: 'require' })).toEqual([
      'TPS_DB_TLS must be verify-full or disable.',
    ]);
  });

  it('takes the certificate authority from a variable, or from a file as it is', () => {
    const fromVariable = loadConfig({ ...deployed, TPS_DB_TLS_CA: CERTIFICATE }, readFile);
    expect(fromVariable.database.tls).toEqual({ mode: 'verify-full', ca: CERTIFICATE });

    const fromFile = loadConfig(
      { ...deployed, TPS_DB_TLS_CA_FILE: '/run/secrets/db_ca' },
      readFile,
    );
    expect(fromFile.database.tls).toEqual({ mode: 'verify-full', ca: CERTIFICATE });
  });

  it('refuses both the certificate authority and its file', () => {
    expect(
      problemsOf({
        ...deployed,
        TPS_DB_TLS_CA: CERTIFICATE,
        TPS_DB_TLS_CA_FILE: '/run/secrets/db_ca',
      }),
    ).toEqual(['Set TPS_DB_TLS_CA or TPS_DB_TLS_CA_FILE, not both.']);
  });

  it('refuses a certificate authority when the connection is not verified', () => {
    const withCa = { ...deployed, TPS_DB_TLS_CA: CERTIFICATE };
    const message = 'TPS_DB_TLS_CA is used only with TPS_DB_TLS=verify-full.';

    expect(problemsOf({ ...withCa, TPS_DB_TLS: 'disable' })).toEqual([message]);
    expect(problemsOf({ ...without(withCa, 'TPS_DB_TLS'), TPS_DB_HOST: 'localhost' })).toEqual([
      message,
    ]);
  });

  it('names the variable when the certificate file cannot be read, or is empty', () => {
    expect(problemsOf({ ...deployed, TPS_DB_TLS_CA_FILE: '/nowhere' })).toEqual([
      'TPS_DB_TLS_CA_FILE names a file that cannot be read.',
    ]);
    expect(problemsOf({ ...deployed, TPS_DB_TLS_CA_FILE: '/run/secrets/empty' })).toEqual([
      'TPS_DB_TLS_CA must hold a certificate in PEM format.',
    ]);
  });
});

describe('the mail server', () => {
  const SMTP_PASSWORD_FILE = '/run/secrets/smtp_password';
  const withFiles: Record<string, string> = {
    ...files,
    [SMTP_PASSWORD_FILE]: 'smtp-password-from-a-file\n',
  };
  const readSmtpFile = (path: string): string => {
    const content = withFiles[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };

  it('starts without a mail server, as the stack and pnpm dev do until the sender exists', () => {
    const noMail = (env: Env): Env =>
      Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('TPS_SMTP_')));

    expect(loadConfig(noMail(deployed), readFile).smtp).toBeUndefined();
    expect(loadConfig(noMail(development), readFile).smtp).toBeUndefined();
  });

  it('names every mail setting still missing once any is set', () => {
    expect(problemsOf({ TPS_SMTP_HOST: 'smtp.internal' })).toEqual(
      expect.arrayContaining([
        'Set TPS_SMTP_PORT.',
        'Set TPS_SMTP_TLS.',
        'Set TPS_SMTP_FROM.',
      ]) as string[],
    );
    expect(problemsOf(without(deployed, 'TPS_SMTP_TLS'))).toEqual(['Set TPS_SMTP_TLS.']);
  });

  it('refuses no TLS for a mail server on the stack network, which is not on this machine', () => {
    const stack = { ...development, TPS_SMTP_HOST: 'mailpit' };

    expect(problemsOf({ ...stack, TPS_SMTP_TLS: 'none' })).toEqual([
      expect.stringContaining('TPS_SMTP_TLS=none') as string,
    ]);
  });

  it('reads the mail server, with no credentials unless both are set', () => {
    expect(loadConfig(deployed, readFile).smtp).toEqual({
      host: 'smtp.internal',
      port: 587,
      tls: 'starttls',
      from: 'grants@example.org',
    });
  });

  it('reads the password from a variable or a file, and keeps it out of output', () => {
    const env = { ...deployed, TPS_SMTP_USER: 'mailer' };
    const fromVariable = loadConfig({ ...env, TPS_SMTP_PASSWORD: 'p4ss' }, readFile).smtp;
    expect(fromVariable?.auth?.user).toBe('mailer');
    expect(fromVariable?.auth?.password.reveal()).toBe('p4ss');
    const fromFile = loadConfig(
      { ...env, TPS_SMTP_PASSWORD_FILE: SMTP_PASSWORD_FILE },
      readSmtpFile,
    ).smtp;
    expect(fromFile?.auth?.password.reveal()).toBe('smtp-password-from-a-file');
    expect(JSON.stringify(fromFile)).not.toContain('smtp-password-from-a-file');
    expect(inspect(fromFile)).not.toContain('smtp-password-from-a-file');
  });

  it('refuses a user without a password and a password without a user', () => {
    expect(problemsOf({ ...deployed, TPS_SMTP_USER: 'mailer' })).toEqual([
      expect.stringContaining('Set TPS_SMTP_PASSWORD or TPS_SMTP_PASSWORD_FILE') as string,
    ]);
    expect(problemsOf({ ...deployed, TPS_SMTP_PASSWORD: 'p4ss' })).toEqual([
      expect.stringContaining('Set TPS_SMTP_USER') as string,
    ]);
  });

  it('refuses setting a password both ways', () => {
    expect(
      problemsOf({
        ...deployed,
        TPS_SMTP_USER: 'mailer',
        TPS_SMTP_PASSWORD: 'p4ss',
        TPS_SMTP_PASSWORD_FILE: SMTP_PASSWORD_FILE,
      }),
    ).toEqual(['Set TPS_SMTP_PASSWORD or TPS_SMTP_PASSWORD_FILE, not both.']);
  });

  it('accepts starttls and tls, and refuses any other mode', () => {
    expect(loadConfig({ ...deployed, TPS_SMTP_TLS: 'tls' }, readFile).smtp?.tls).toBe('tls');
    expect(problemsOf({ ...deployed, TPS_SMTP_TLS: 'ssl' })).toEqual([
      'TPS_SMTP_TLS must be starttls, tls or none.',
    ]);
  });

  it('allows no TLS only for a mail server at a loopback IP address, with or without TPS_DEV', () => {
    expect(loadConfig(development, readFile).smtp?.tls).toBe('none');
    // The stack: no TPS_DEV, and Mailpit on the API container's own loopback.
    for (const host of ['127.0.0.1', '::1']) {
      const smtp = loadConfig(
        { ...deployed, TPS_SMTP_TLS: 'none', TPS_SMTP_HOST: host },
        readFile,
      ).smtp;
      expect(smtp).toMatchObject({ host, tls: 'none' });
    }
    const refusal = [expect.stringContaining('TPS_SMTP_TLS=none') as string];
    expect(problemsOf({ ...deployed, TPS_SMTP_TLS: 'none' })).toEqual(refusal);
    expect(problemsOf({ ...development, TPS_SMTP_HOST: 'smtp.internal' })).toEqual(refusal);
    // A name, even localhost, is resolved through DNS first, so it could lead elsewhere.
    expect(problemsOf({ ...development, TPS_SMTP_HOST: 'localhost' })).toEqual(refusal);
  });

  it('refuses a mail server login sent in clear outside development', () => {
    const login = {
      TPS_SMTP_HOST: '127.0.0.1',
      TPS_SMTP_TLS: 'none',
      TPS_SMTP_USER: 'mailer',
      TPS_SMTP_PASSWORD: 'p4ss',
    };
    expect(problemsOf({ ...deployed, ...login })).toEqual([
      expect.stringContaining('A mail server login is sent in clear') as string,
    ]);
    expect(loadConfig({ ...development, ...login }, readFile).smtp?.auth?.user).toBe('mailer');
  });

  it('refuses a sender address that is not an address, or holds a line break', () => {
    for (const from of ['grants', 'a@b.c\r\nBcc: x@y.z', 'grants@example.org\n', ' a@b.org']) {
      expect(problemsOf({ ...deployed, TPS_SMTP_FROM: from }), from).toEqual([
        'TPS_SMTP_FROM must be an email address, such as grants@example.org.',
      ]);
    }
  });

  it('refuses a host or port that is not valid', () => {
    expect(problemsOf({ ...deployed, TPS_SMTP_HOST: 'smtp host', TPS_SMTP_PORT: '0' })).toEqual([
      'TPS_SMTP_HOST must be a host name or an IP address.',
      'TPS_SMTP_PORT must be a port number from 1 to 65535.',
    ]);
  });

  it('refuses a user with a line break', () => {
    expect(problemsOf({ ...deployed, TPS_SMTP_USER: 'a\nb', TPS_SMTP_PASSWORD: 'p4ss' })).toEqual([
      expect.stringContaining('TPS_SMTP_USER must be') as string,
    ]);
  });
});
