// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The secret re-encryption command (ADR 0010, "Secrets at rest"), run once
// before an old auth key version is removed. It reads the auth settings as
// the API does, refuses to start unless they pass the API's checks and name
// more than one key version, and connects only as app_auth. It prints counts
// and codes, never a secret, an id or an address.

import { randomUUID } from 'node:crypto';

import { createDatabase, type Env } from '@pixel-scientists/db';

import { ConfigError, loadConfig, type Secret } from '../../config.ts';
import { createSender, type Sender } from '../../email/sender.ts';
import { createSmtpTransport } from '../../email/transport.ts';
import { createLogger } from '../../logger.ts';
import { loadAuthSettings } from '../settings.ts';
import { reencryptSecrets, rotationKeys } from './reencrypt.ts';

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

/** Settings that only the API's listener and its own role use. */
const UNUSED = {
  TPS_API_HOST: '127.0.0.1',
  TPS_API_PORT: '1',
  TPS_DB_APP_API_PASSWORD: 'unused-by-the-re-encryption-command',
  TPS_DB_APP_API_PASSWORD_FILE: '',
} as const;

export interface Options {
  /** The auth secret by key version; the settings' one secret is version 1. */
  readonly secrets?: ReadonlyMap<number, Secret>;
  /** Replaces the configured mail server. */
  readonly sender?: Sender;
}

/** Run the command. Returns the exit code: 0 once every row is on the newest version. */
export async function runSecretReencryption(
  env: Env,
  output: Output,
  options: Options = {},
): Promise<number> {
  let settings;
  let config;
  try {
    settings = loadAuthSettings(env);
    config = loadConfig({ ...env, ...UNUSED });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const problem of error.problems) output.err(problem);
    return 2;
  }
  const secrets = options.secrets ?? new Map([[1, settings.secret]]);
  if (secrets.size < 2) {
    output.err('Only one auth key version is configured, so there is nothing to re-encrypt.');
    return 2;
  }

  const keys = rotationKeys(secrets);
  const log = createLogger({ level: 'warn' });
  const { database, smtp } = config;
  const auth = createDatabase<unknown>({
    host: database.host,
    port: database.port,
    database: database.database,
    role: 'app_auth',
    password: settings.databasePassword.reveal(),
    applicationName: 'tps-reencrypt',
    tls: database.tls,
  });
  try {
    const sender = options.sender ?? createSender(smtp, log, createSmtpTransport(smtp));
    const { counts, error } = await reencryptSecrets({
      auth,
      keys,
      sender,
      log,
      requestId: randomUUID(),
    });
    const version = String(keys.current);
    output.out(`Re-encrypted ${String(counts.totp)} TOTP secrets to key version ${version}.`);
    output.out(`Re-encrypted ${String(counts.sso)} SSO providers to key version ${version}.`);
    output.out(
      `Asked ${String(counts.backupNotices)} of ${String(counts.backupFound)} users with ` +
        'backup codes on an older key version to generate new ones.',
    );
    if (counts.backupFound > 0) {
      output.out('Do not remove an older key version while any user still has codes on it.');
    }
    if (error !== undefined) {
      output.err(`Re-encryption stopped with error code ${error}. Run the command again.`);
      return 1;
    }
    return 0;
  } finally {
    await auth.destroy();
  }
}
