// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';

import { BACKUP_ROLE } from '../../../packages/db/scripts/roles.ts';

import { BackupError } from './codes.ts';
import {
  ageArguments,
  connectionString,
  dumpArguments,
  keyDumpArguments,
  parseFileRows,
  parseIdentity,
  parsePgDumpVersion,
  passFileLine,
  snapshotQuery,
} from './commands.ts';
import { describe, it } from './testing.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const SERVER = { host: 'db.internal', port: 5432, caFile: '/run/ca.pem' };

describe('connectionString', () => {
  it('uses verify-full, the backup role and a password file', () => {
    const text = connectionString(SERVER, 'grants', '/scratch/pgpass');
    assert.match(text, /sslmode='verify-full'/);
    assert.match(text, /sslrootcert='\/run\/ca\.pem'/);
    assert.match(text, new RegExp(`user='${BACKUP_ROLE}'`));
    assert.match(text, /passfile='\/scratch\/pgpass'/);
    assert.doesNotMatch(text, /password=/);
  });

  it('turns TLS off only for a server with no CA, which settings allow only on this machine', () => {
    const text = connectionString({ ...SERVER, caFile: null }, 'grants', '/scratch/pgpass');
    assert.match(text, /sslmode='disable'/);
    assert.doesNotMatch(text, /sslrootcert/);
  });

  it('quotes values, so a value cannot add an option', () => {
    const text = connectionString({ ...SERVER, host: "x' user='other" }, 'g', '/p');
    assert.match(text, /host='x\\' user=\\'other'/);
  });
});

describe('passFileLine', () => {
  it('escapes separators in the password', () => {
    assert.equal(
      passFileLine(SERVER, 'pa:ss\\word'),
      `db.internal:5432:*:${BACKUP_ROLE}:pa\\:ss\\\\word\n`,
    );
  });
});

describe('dumpArguments', () => {
  it('takes a custom-format dump that leaves out subject keys', () => {
    const args = dumpArguments('host=x', 'SNAP');
    assert.ok(args.includes('--format=custom'));
    assert.ok(args.includes('--exclude-table-data=app.subject_key'));
    assert.ok(args.includes('--snapshot=SNAP'));
    assert.ok(args.includes('--no-password'));
  });

  it('never enables row security, which would dump only visible rows', () => {
    for (const args of [
      dumpArguments('host=x', 'SNAP'),
      dumpArguments('host=x', null),
      keyDumpArguments('host=x', 'SNAP'),
    ]) {
      assert.ok(!args.some((arg) => arg.includes('row-security')));
    }
  });

  it('omits the snapshot for a database with no held snapshot', () => {
    assert.ok(!dumpArguments('host=x', null).some((arg) => arg.startsWith('--snapshot')));
  });
});

describe('keyDumpArguments', () => {
  it('dumps only the subject keys, as data, from the same snapshot', () => {
    assert.deepEqual(keyDumpArguments('host=x', 'SNAP'), [
      '--format=custom',
      '--no-password',
      '--data-only',
      '--table=app.subject_key',
      '--snapshot=SNAP',
      '--dbname=host=x',
    ]);
  });
});

describe('ageArguments', () => {
  it('encrypts to the recipients file and writes to a file', () => {
    assert.deepEqual(ageArguments('/etc/recipients', '/scratch/out'), [
      '--encrypt',
      '--recipients-file',
      '/etc/recipients',
      '--output',
      '/scratch/out',
    ]);
  });
});

describe('parseIdentity', () => {
  it('reads the role, exemption and versions', () => {
    const identity = parseIdentity(
      `${BACKUP_ROLE}|${BACKUP_ROLE}|t|160004|16.4 (Debian)|tps-roles-version=5|0045_x\n`,
    );
    assert.equal(identity.user, BACKUP_ROLE);
    assert.equal(identity.exempt, true);
    assert.equal(identity.serverVersionNum, 160004);
    assert.equal(identity.rolesScript, '5');
    assert.equal(identity.migration, '0045_x');
  });

  it('reads a role without the exemption or a roles version', () => {
    const identity = parseIdentity('app_api|app_api|f|160004|16.4||\n');
    assert.equal(identity.exempt, false);
    assert.equal(identity.rolesScript, null);
  });

  it('refuses output it cannot read', () => {
    assert.throws(() => parseIdentity('nonsense'), BackupError);
    assert.throws(() => parseIdentity('a|b|t|x|16.4|c|d'), BackupError);
  });
});

describe('parsePgDumpVersion', () => {
  it('reads the major and full version', () => {
    assert.deepEqual(parsePgDumpVersion('pg_dump (PostgreSQL) 17.2 (Debian 17.2-1)\n'), {
      major: 17,
      version: '17.2',
    });
    assert.deepEqual(parsePgDumpVersion('pg_dump (PostgreSQL) 18beta1\n'), {
      major: 18,
      version: '18',
    });
  });

  it('refuses anything else', () => {
    assert.throws(() => parsePgDumpVersion('nothing'), BackupError);
  });
});

describe('parseFileRows', () => {
  const row = (key: string) => `${TENANT}|${FILE}|${key}|${'a'.repeat(64)}|123`;

  it('reads clean files', () => {
    assert.deepEqual(parseFileRows(`${row(`clean/${TENANT}/${FILE}`)}\n`), [
      {
        tenantId: TENANT,
        fileId: FILE,
        storageKey: `clean/${TENANT}/${FILE}`,
        contentSha256: 'a'.repeat(64),
        contentSize: 123,
      },
    ]);
  });

  it('refuses a key outside the clean prefix', () => {
    assert.throws(
      () => parseFileRows(row(`quarantine/${TENANT}/${FILE}`)),
      (error: unknown) => error instanceof BackupError && error.code === 'file_key_refused',
    );
  });

  it('refuses a row it cannot read', () => {
    assert.throws(() => parseFileRows('not|a|row'), BackupError);
  });

  it('treats no rows as no files', () => {
    assert.deepEqual(parseFileRows('\n'), []);
  });
});

describe('snapshotQuery', () => {
  it('reads inside the exported snapshot', () => {
    assert.match(
      snapshotQuery('SNAP', 'SELECT 1'),
      /REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT 'SNAP'; SELECT 1; COMMIT$/,
    );
  });
});
