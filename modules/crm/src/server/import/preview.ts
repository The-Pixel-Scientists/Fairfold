// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The import preview (ADR 0025): a page of the file's rows, each with its
// errors as a field id and a code and, for a row like an existing record,
// party's duplicate signals. It creates nothing. The cells are personal, so
// every page read writes `crm.import.previewed` with the job id and no value.
// The signals are asked of party again for the page, since only the matching
// record's id is stored with the row.

import {
  crmReadAudits,
  type ImportRowError,
  type importRowPageSchema,
} from '../../contracts/index.ts';
import { nextCursor, PAGE, readCursor, type Args, type CrmDependencies } from '../context.ts';
import { importDb, type ImportDependencies } from './context.ts';
import { partyInput, type Cells } from './rows.ts';

type RowPage = (typeof importRowPageSchema)['_output'];

export function previewHandlers(deps: CrmDependencies, imports: ImportDependencies) {
  async function listImportRows({
    tx,
    context,
    input,
  }: Args<{
    params: { importId: string };
    query: { cursor?: string | undefined };
  }>): Promise<RowPage> {
    const { importId } = input.params;
    const offset = readCursor(input.query.cursor, deps);
    const db = importDb(tx);
    const job = await db
      .selectFrom('crm.import_job')
      .select('target_kind')
      .where('id', '=', importId)
      .executeTakeFirst();
    if (job === undefined) throw deps.notFound();
    await context.audit.read({ action: crmReadAudits.listImportRows, entityId: importId });

    const found = await db
      .selectFrom('crm.import_row')
      .select(['row_number', 'cells', 'errors', 'duplicate_party_id'])
      .where('job_id', '=', importId)
      .orderBy('row_number')
      .limit(PAGE + 1)
      .offset(offset)
      .execute();
    const rows: RowPage['rows'] = [];
    for (const row of found.slice(0, PAGE)) {
      const cells = row.cells as Cells;
      const errors = row.errors as ImportRowError[];
      const similar =
        row.duplicate_party_id === null || Object.keys(cells).length === 0
          ? []
          : await imports.parties.duplicates(tx, partyInput(job.target_kind, cells));
      rows.push({
        row: row.row_number,
        status:
          errors.length > 0 ? 'error' : row.duplicate_party_id === null ? 'valid' : 'duplicate',
        values: cells,
        errors,
        duplicates: similar.map(({ partyId, signals }) => ({ partyId, signals: [...signals] })),
      });
    }
    return { rows, nextCursor: nextCursor(offset, found.length) };
  }

  return { listImportRows };
}
