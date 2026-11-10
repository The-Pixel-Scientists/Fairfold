// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every way a run can end. Errors are codes: a tool's message can name a
// host, a key or a file, so nothing else ever reaches the run log.

export type FailureCode =
  | 'settings_invalid'
  | 'role_refused'
  | 'role_not_exempt'
  | 'postgres_too_old'
  | 'pg_dump_too_old'
  | 'recipients_invalid'
  | 'bucket_lock_missing'
  | 'probe_failed'
  | 'database_failed'
  | 'dump_failed'
  | 'encrypt_failed'
  | 'source_failed'
  | 'store_failed'
  | 'file_key_refused'
  | 'file_hash_mismatch'
  | 'upload_mismatch'
  | 'index_invalid'
  | 'retain_date_refused'
  | 'prune_failed'
  | 'unexpected';

export type Outcome = 'ok' | 'already_complete' | FailureCode;

export class BackupError extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode) {
    super(code);
    this.code = code;
  }
}

/** The code for anything a run throws: only a BackupError carries one. */
export function failureCode(error: unknown): FailureCode {
  return error instanceof BackupError ? error.code : 'unexpected';
}
