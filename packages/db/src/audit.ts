// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one insert into app.audit_event (architecture rule 4). The tenant
// comes from the transaction, and each change keeps its values only when
// the classification map marks the field public or internal (D12); any
// other classified column, and every form field, is recorded by its id alone.
// A key that is neither a classified column nor a form field id is refused.
// The audit writer in apps/api/src/audit checks the action and the actor
// before calling this.

import { sql, type Transaction } from 'kysely';

import { classification } from '../classification.ts';

/** A column's field id, `<schema>.<table>.<column>`. */
const COLUMN_FIELD_ID = /^([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;
/** A form field's id (packages/domain forms), whose values are never kept. */
const FORM_FIELD_ID = /^f_[a-z0-9]{1,32}$/;

/** One field's change. A value left out, or not kept, is not recorded. */
export interface FieldChange {
  readonly before?: unknown;
  readonly after?: unknown;
}

/** Changes keyed by field id. */
export type AuditChanges = Readonly<Record<string, FieldChange>>;

export interface AuditEventRow {
  readonly requestId: string;
  readonly actorKind: 'user' | 'system' | 'operator';
  /** The acting membership, exactly when `actorKind` is `user`. */
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly changes: AuditChanges;
}

/**
 * The changes as stored: `{ before, after }` for a public or internal field,
 * and `{}` for any other. Refuses a key that is not a classified column or a
 * form field id, so no value can be passed as a key.
 */
export function keptChanges(changes: AuditChanges): Record<string, FieldChange> {
  return Object.fromEntries(
    Object.entries(changes).map(([field, { before, after }]) => [
      field,
      mayKeepValues(field) ? { before, after } : {},
    ]),
  );
}

function mayKeepValues(field: string): boolean {
  if (FORM_FIELD_ID.test(field)) return false;
  const [, table = '', name = ''] = COLUMN_FIELD_ID.exec(field) ?? [];
  const fields = Object.hasOwn(classification, table) ? classification[table] : undefined;
  const column = fields && Object.hasOwn(fields, name) ? fields[name] : undefined;
  if (!column) {
    throw new Error('Audit changes are keyed by a classified column id or a form field id.');
  }
  return column.sensitivity === 'public' || column.sensitivity === 'internal';
}

/**
 * Insert one event in the transaction's tenant. The database sets its id,
 * occurred_at and retain_until.
 */
export async function insertAuditEvent<DB>(
  trx: Transaction<DB>,
  row: AuditEventRow,
): Promise<void> {
  const changes = JSON.stringify(keptChanges(row.changes));
  await sql`
    INSERT INTO app.audit_event
      (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id, changes)
    VALUES (app.current_tenant_id(), ${row.requestId}, ${row.actorKind}, ${row.actorId},
            ${row.action}, ${row.entityType}, ${row.entityId}, ${changes}::jsonb)
  `.execute(trx);
}
