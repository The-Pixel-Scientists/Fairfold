// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The documents tables' contribution to subject access (ADR 0016, ADR 0027,
// ADR 0040): the signature requests a person is asked to sign and their own
// signer records, each classified column keyed by its field id with the
// sensitivity the classification map gives it. A request's provider
// reference and the hash of the file sent are never exported, and other
// signers' records are not the person's. Board pack outputs are job outputs
// that expire with their job request, so they need no contribution. Read in
// the caller's transaction, so row-level security leaves out any other tenant.

import type { Transaction } from '@pixel-scientists/db';
import type {
  SubjectData,
  SubjectDataContribution,
  SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';

type Sensitivity = SubjectDataRow[string]['sensitivity'];
type Columns = readonly (readonly [string, Sensitivity])[];

const internal = (...names: string[]): Columns => names.map((name) => [name, 'internal']);

/** Copies the classification map, which a contribution may not import; the platform checks each cell against the map again. */
const signer: Columns = [
  ...internal('tenant_id', 'id', 'signature_request_id'),
  ['person_id', 'personal'],
  ...internal('signing_order', 'status', 'signed_at', 'created_at', 'updated_at'),
];

const request: Columns = internal(
  'tenant_id',
  'id',
  'connection_id',
  'status',
  'error_code',
  'template_version_id',
  'expires_at',
  'created_by',
  'created_at',
  'updated_at',
);

type Tables = Record<string, Record<string, unknown>>;

const cellValue = (value: unknown): SubjectDataRow[string]['value'] =>
  value instanceof Date ? value.toISOString() : ((value ?? null) as never);

const toRow = (table: string, columns: Columns, row: Record<string, unknown>): SubjectDataRow =>
  Object.fromEntries(
    columns.map(([column, sensitivity]) => [
      `${table}.${column}`,
      { value: cellValue(row[column]), sensitivity },
    ]),
  );

export const documentsSubjectData: SubjectDataContribution<'platform', Transaction<unknown>> = {
  module: 'platform',
  async subjectData(tx, subjectPartyId) {
    const db = tx.$extendTables<Tables>();
    const signers = await db
      .selectFrom('app.signature_signer')
      .select(signer.map(([name]) => name))
      .where('person_id', '=', subjectPartyId)
      .orderBy('id')
      .execute();
    const requestIds = signers.map((row) => String(row['signature_request_id']));
    const requests =
      requestIds.length === 0
        ? []
        : await db
            .selectFrom('app.signature_request')
            .select(request.map(([name]) => name))
            .where('id', 'in', requestIds)
            .orderBy('id')
            .execute();
    const data: SubjectData = {
      'app.signature_request': requests.map((row) => toRow('app.signature_request', request, row)),
      'app.signature_signer': signers.map((row) => toRow('app.signature_signer', signer, row)),
    };
    return data;
  },
};
