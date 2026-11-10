// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';

import { readSettings } from './settings.ts';
import { describe, it } from './testing.ts';

const ENV = {
  TPS_DB_HOST: 'db.internal',
  TPS_DB_PORT: '5432',
  TPS_DB_TLS: 'verify-full',
  TPS_DB_TLS_CA_FILE: '/run/secrets/db-ca',
  TPS_DB_BACKUP_READER_PASSWORD_FILE: '/run/secrets/db-password',
  TPS_BACKUP_DATABASES: 'grants,metadata',
  TPS_BACKUP_PG_DUMP: '/usr/bin/pg_dump',
  TPS_BACKUP_PSQL: '/usr/bin/psql',
  TPS_BACKUP_AGE: '/usr/bin/age',
  TPS_BACKUP_S3_CLIENT: '/usr/bin/aws',
  TPS_BACKUP_STORE_ENDPOINT: 'https://store.example',
  TPS_BACKUP_STORE_REGION: 'uk-1',
  TPS_BACKUP_STORE_BUCKET: 'backups',
  TPS_BACKUP_STORE_CREDENTIALS_FILE: '/run/secrets/store',
  TPS_STORAGE_ENDPOINT: 'https://files.example',
  TPS_STORAGE_REGION: 'uk-1',
  TPS_STORAGE_BUCKET: 'files',
  TPS_BACKUP_SOURCE_CREDENTIALS_FILE: '/run/secrets/source',
  TPS_BACKUP_RECIPIENTS_FILE: '/etc/backup/recipients',
  TPS_BACKUP_KEY_ID: 'backup-2026-1',
  TPS_BACKUP_SCRATCH_DIR: '/scratch',
};

const refused = (env: Record<string, string | undefined>, message: RegExp) => {
  assert.throws(() => readSettings({ ...ENV, ...env }), message);
};

describe('readSettings', () => {
  it('reads a complete configuration', () => {
    const settings = readSettings(ENV);
    assert.equal(settings.applicationDatabase, 'grants');
    assert.deepEqual(settings.otherDatabases, ['metadata']);
    assert.equal(settings.caFile, '/run/secrets/db-ca');
    assert.equal(settings.store.bucket, 'backups');
    assert.equal(settings.source.bucket, 'files');
  });

  for (const name of [
    'TPS_DB_BACKUP_READER_PASSWORD',
    'TPS_BACKUP_STORE_CREDENTIALS',
    'TPS_BACKUP_SOURCE_CREDENTIALS',
  ]) {
    it(`refuses ${name} as a value in the environment`, () => {
      refused({ [name]: 'a-secret-value' }, new RegExp(`Set ${name}_FILE`));
    });
  }

  it('never puts a credential value in its error', () => {
    try {
      readSettings({ ...ENV, TPS_DB_BACKUP_READER_PASSWORD: 'a-secret-value' });
      assert.fail('expected a refusal');
    } catch (error) {
      assert.doesNotMatch(String(error), /a-secret-value/);
    }
  });

  it('requires verify-full for a remote database', () => {
    refused({ TPS_DB_TLS: 'disable' }, /verify-full/);
    refused({ TPS_DB_TLS: undefined, TPS_DB_TLS_CA_FILE: undefined }, /TPS_DB_TLS_CA_FILE/);
  });

  it('requires a CA file with verify-full', () => {
    refused({ TPS_DB_TLS_CA_FILE: undefined }, /TPS_DB_TLS_CA_FILE/);
  });

  it('lets a database on this machine go without TLS', () => {
    const settings = readSettings({ ...ENV, TPS_DB_HOST: '127.0.0.1', TPS_DB_TLS: 'disable' });
    assert.equal(settings.caFile, null);
  });

  it('refuses a plain endpoint unless it is on this machine', () => {
    refused({ TPS_BACKUP_STORE_ENDPOINT: 'http://store.example' }, /must use https/);
    refused({ TPS_BACKUP_STORE_ENDPOINT: 'not a url' }, /must be a URL/);
    assert.equal(
      readSettings({ ...ENV, TPS_BACKUP_STORE_ENDPOINT: 'http://127.0.0.1:8333' }).store.endpoint,
      'http://127.0.0.1:8333',
    );
  });

  it('refuses a tool path that is not absolute', () => {
    refused({ TPS_BACKUP_PG_DUMP: 'pg_dump' }, /absolute/);
  });

  it('refuses PostgreSQL system databases and bad names', () => {
    refused({ TPS_BACKUP_DATABASES: 'postgres' }, /own database/);
    refused({ TPS_BACKUP_DATABASES: 'grants,Bad-Name' }, /lower-case/);
  });

  it('refuses a key id that could not be an object name', () => {
    refused({ TPS_BACKUP_KEY_ID: '../key' }, /TPS_BACKUP_KEY_ID/);
  });
});
