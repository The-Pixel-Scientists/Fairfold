// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The parse job (ADR 0009, ADR 0025): reads an uploaded file once, checks
// every row and stores what it found, so staff see every problem and every
// likely duplicate before anything is created. It runs as the worker in the
// job's tenant transaction, and the platform wraps it in the job's queue. The
// job's id is all the payload holds: the file, kind and mapping come from the
// job row. A file that cannot be imported fails the job with one of the
// contract's codes, never a cell, header, file name or exception text.
// Delivery is at least once, so a second run finds the job past `queued` and
// does nothing, and rows are inserted on conflict do nothing.

import { IMPORT_MAX_ROWS, type ImportField, type ImportRowError } from '../../contracts/index.ts';
import type { Tx } from '../context.ts';
import { crmEnabled, importDb, type ImportDependencies } from './context.ts';
import { CsvFailure, readCsv, type ImportFailure } from './csv.ts';
import { checkRow, partyInput, type Cells } from './rows.ts';

export type ParseOutcome = 'parsed' | 'refused' | 'skipped' | 'missing';

/** Rows in one insert. */
const CHUNK = 500;

interface Parsed {
  readonly row_number: number;
  readonly cells: Cells;
  readonly errors: ImportRowError[];
  readonly duplicate_party_id: string | null;
}

export function importParser(deps: ImportDependencies) {
  async function parseImport(tx: Tx, importId: string): Promise<ParseOutcome> {
    if (!(await crmEnabled(tx))) return 'skipped';
    const db = importDb(tx);
    const job = await db
      .selectFrom('crm.import_job')
      .select(['file_id', 'target_kind', 'header_row', 'column_mapping', 'state'])
      .where('id', '=', importId)
      .executeTakeFirst();
    if (job === undefined) return 'missing';
    if (job.state !== 'queued') return 'skipped';
    const move = (change: { state: string; error_code?: string }) =>
      db.updateTable('crm.import_job').set(change).where('id', '=', importId).execute();
    await move({ state: 'checking' });

    const source = await deps.files.open(tx, job.file_id);
    let records: string[][] = [];
    let failure: ImportFailure | null = source === null ? 'file_unreadable' : null;
    if (source !== null) {
      try {
        records = await readCsv(source, IMPORT_MAX_ROWS + (job.header_row ? 1 : 0));
      } catch (error) {
        if (!(error instanceof CsvFailure)) throw error;
        failure = error.code;
      }
    }

    const mapping = job.column_mapping as Record<string, ImportField>;
    const seen = new Set<string>();
    const rows: Parsed[] = [];
    for (const [index, record] of records.entries()) {
      if (index === 0 && job.header_row) continue;
      if (record.length === 1 && record[0] === '') continue;
      const { cells, errors } = checkRow(job.target_kind, mapping, record, seen);
      const [candidate] =
        errors.length > 0
          ? []
          : await deps.parties.duplicates(tx, partyInput(job.target_kind, cells));
      rows.push({
        row_number: index + 1,
        cells,
        errors,
        duplicate_party_id: candidate?.partyId ?? null,
      });
    }
    if (failure === null && rows.length === 0) failure = 'no_rows';
    if (failure !== null) {
      await move({ state: 'failed', error_code: failure });
      return 'refused';
    }

    for (let start = 0; start < rows.length; start += CHUNK) {
      await db
        .insertInto('crm.import_row')
        .values((eb) =>
          rows.slice(start, start + CHUNK).map(({ cells, errors, ...row }) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            job_id: importId,
            cells: JSON.stringify(cells),
            errors: JSON.stringify(errors),
            ...row,
          })),
        )
        .onConflict((conflict) =>
          conflict.columns(['tenant_id', 'job_id', 'row_number']).doNothing(),
        )
        .execute();
    }
    const counts = await db
      .selectFrom('crm.import_row')
      .select((eb) => [
        eb.fn.countAll<string>().as('total'),
        eb.fn.countAll<string>().filterWhere('errors', '=', '[]').as('valid'),
      ])
      .where('job_id', '=', importId)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('crm.import_job')
      .set({ state: 'ready', row_count: Number(counts.total), valid_count: Number(counts.valid) })
      .where('id', '=', importId)
      .execute();
    return 'parsed';
  }

  return parseImport;
}
