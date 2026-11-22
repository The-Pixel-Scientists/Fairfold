// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Confirming an import (ADR 0025, ADR 0010; architecture rule 9). A named
// member confirms a checked job, behind step-up that the platform enforces
// from the route. One request creates a record for every row without errors,
// through party's contract, and skips rows like an existing record unless
// staff chose to add them. It is all or nothing: any failure undoes every
// record and row update with the request's transaction. A row with a created
// record is never made again. Each record is audited by party's own created
// action with that record as the subject; the job writes `crm.import.confirmed`
// with its id and counts only. An import never records consent, a contact
// preference or an account, never links or merges anyone and never sends.

import type { ImportRowError } from '../../contracts/index.ts';
import type { Args, AuditChanges, CrmDependencies } from '../context.ts';
import { importDb, type ImportDependencies, type NewParty } from './context.ts';
import { partyInput, type Cells } from './rows.ts';

const NOT_READY =
  'This import is not ready to confirm. Wait for the check to finish, or start a new import if it failed.';

const fields = (table: string, columns: readonly string[]): AuditChanges =>
  Object.fromEntries(columns.map((column) => [`${table}.${column}`, {}]));

const ORGANISATION_FIELDS = [
  'name',
  'legal_form',
  'address_line1',
  'address_line2',
  'address_town',
  'address_postcode',
  'address_country_code',
  'website',
] as const;

/** The field ids a created record has, with no value. */
function createdFields(party: NewParty): AuditChanges {
  if (party.kind === 'person') {
    return fields('party.person', [
      'given_name',
      'family_name',
      'email',
      ...(party.input.phone === undefined ? [] : ['phone']),
    ]);
  }
  return {
    ...fields('party.organisation', ORGANISATION_FIELDS),
    ...(party.input.identifiers.length === 0
      ? {}
      : fields('party.organisation_identifier', ['scheme', 'identifier'])),
  };
}

export function confirmHandlers(deps: CrmDependencies, imports: ImportDependencies) {
  async function confirmImport({
    tx,
    context,
    input,
  }: Args<{ params: { importId: string }; body: { duplicates: 'skip' | 'create' } }>): Promise<{
    created: number;
    skippedErrors: number;
    skippedDuplicates: number;
  }> {
    const { importId } = input.params;
    const membershipId = context.membership.id;
    const db = importDb(tx);
    const job = await db
      .selectFrom('crm.import_job')
      .select(['target_kind', 'state', 'row_count'])
      .where('id', '=', importId)
      .executeTakeFirst();
    if (job === undefined) throw deps.notFound();
    if (job.state !== 'ready') throw deps.refuse(409, NOT_READY);
    const moved = await db
      .updateTable('crm.import_job')
      .set({ state: 'importing', confirmed_by: membershipId })
      .where('id', '=', importId)
      .where('state', '=', 'ready')
      .executeTakeFirst();
    if (Number(moved.numUpdatedRows) === 0) throw deps.refuse(409, NOT_READY);

    const rows = await db
      .selectFrom('crm.import_row')
      .select(['id', 'cells', 'errors', 'duplicate_party_id'])
      .where('job_id', '=', importId)
      .where('created_party_id', 'is', null)
      .orderBy('row_number')
      .execute();
    const result = { created: 0, skippedErrors: 0, skippedDuplicates: 0 };
    for (const row of rows) {
      const cells = row.cells as Cells;
      if ((row.errors as ImportRowError[]).length > 0 || Object.keys(cells).length === 0) {
        result.skippedErrors++;
      } else if (row.duplicate_party_id !== null && input.body.duplicates === 'skip') {
        result.skippedDuplicates++;
      } else {
        const party = partyInput(job.target_kind, cells);
        const id = await imports.parties.create(tx, party, { membershipId });
        await db
          .updateTable('crm.import_row')
          .set({ created_party_id: id })
          .where('id', '=', row.id)
          .where('created_party_id', 'is', null)
          .execute();
        await context.audit.record({
          action: `party.${party.kind}.created`,
          entityId: id,
          subjectPartyId: id,
          changes: createdFields(party),
        });
        result.created++;
      }
    }

    await db
      .updateTable('crm.import_job')
      .set({ state: 'completed', created_count: result.created })
      .where('id', '=', importId)
      .execute();
    await context.audit.record({
      action: 'crm.import.confirmed',
      entityId: importId,
      changes: {
        'crm.import_job.row_count': { after: job.row_count },
        'crm.import_job.created_count': { after: result.created },
      },
    });
    return result;
  }

  return { confirmImport };
}
