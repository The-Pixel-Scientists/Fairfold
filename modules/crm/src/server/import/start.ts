// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starting an import and reading its state (ADR 0025, ADR 0030). Starting
// links an uploaded file that has passed its virus scan and was never used,
// records who asked, queues the parse job in the same transaction and writes
// `crm.import.started` with ids only: no file name, header or cell. A file
// that is not clean, is another tenant's or is already in use is refused the
// same way, and nothing is written.

import type { PartyKind } from '@pixel-scientists/party/contracts';

import type { ImportJob, ImportStart } from '../../contracts/index.ts';
import { iso, type Args, type CrmDependencies, type Tx } from '../context.ts';
import { importDb, type ImportDependencies } from './context.ts';

/** An import with its row counts: rows that import as they are, with errors, and like an existing record. */
export async function readImport(tx: Tx, id: string): Promise<ImportJob | undefined> {
  const db = importDb(tx);
  const job = await db
    .selectFrom('crm.import_job')
    .select([
      'id',
      'target_kind',
      'state',
      'error_code',
      'row_count',
      'valid_count',
      'created_count',
      'created_at',
      'completed_at',
    ])
    .where('id', '=', id)
    .executeTakeFirst();
  if (job === undefined) return undefined;
  const { duplicates } = await db
    .selectFrom('crm.import_row')
    .select((eb) => eb.fn.count<string>('duplicate_party_id').as('duplicates'))
    .where('job_id', '=', id)
    .executeTakeFirstOrThrow();
  const copies = Number(duplicates);
  return {
    id: job.id,
    target: job.target_kind,
    state: job.state as ImportJob['state'],
    failure: job.error_code as ImportJob['failure'],
    rows: {
      total: job.row_count,
      valid: job.valid_count - copies,
      withErrors: job.row_count - job.valid_count,
      duplicates: copies,
    },
    result:
      job.state === 'completed'
        ? { created: job.created_count, skipped: job.row_count - job.created_count }
        : null,
    createdAt: iso(job.created_at),
    completedAt: job.completed_at === null ? null : iso(job.completed_at),
  };
}

export function startHandlers(deps: CrmDependencies, imports: ImportDependencies) {
  async function startImport({
    tx,
    context,
    input,
  }: Args<{ body: ImportStart }>): Promise<ImportJob> {
    const { fileId, target, headerRow, mapping } = input.body;
    const columns = Object.fromEntries(mapping.map(({ column, field }) => [String(column), field]));
    let id: string | undefined;
    const added = await deps.attempt(tx, async () => {
      id = (
        await importDb(tx)
          .insertInto('crm.import_job')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            file_id: fileId,
            target_kind: target as PartyKind,
            header_row: headerRow,
            column_mapping: JSON.stringify(columns),
            requested_by: context.membership.id,
          }))
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });
    if (!added || id === undefined) {
      throw deps.refuse(
        409,
        'This file cannot be imported. Upload it again, wait for the virus check to finish, then start the import.',
      );
    }
    await imports.queueParse(tx, id, { membershipId: context.membership.id });
    await context.audit.record({
      action: 'crm.import.started',
      entityId: id,
      changes: {
        'crm.import_job.target_kind': { after: target },
        'crm.import_job.file_id': { after: fileId },
      },
    });
    return (await readImport(tx, id)) ?? Promise.reject(deps.notFound());
  }

  async function getImport({
    tx,
    input,
  }: Args<{ params: { importId: string } }>): Promise<ImportJob> {
    return (await readImport(tx, input.params.importId)) ?? Promise.reject(deps.notFound());
  }

  return { startImport, getImport };
}
