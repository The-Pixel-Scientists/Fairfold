// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one insert into app.audit_event (architecture rule 4). The tenant
// comes from the transaction, and each change keeps its values only when
// the classification map marks the field public or internal and not
// structured or free text (D12), and each value is a string, number,
// boolean or null, or a short list of them. Any other change, and every
// form field, is recorded by its id alone. A key that is neither a
// classified column nor a form field id is refused, and so are changes over
// 64 KiB. The audit writer in apps/api/src/audit checks the action and the
// actor before calling this; the database records the actor's member kind.

import { sql, type Transaction } from 'kysely';

import { classification } from '../classification.ts';
import { notKept } from '../classification/app.ts';

/** A column's field id, `<schema>.<table>.<column>`. */
const COLUMN_FIELD_ID = /^([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;
/** A form field's id (packages/domain forms), whose values are never kept. */
const FORM_FIELD_ID = /^f_[a-z0-9]{1,32}$/;
/** The most items a kept list may have. */
const MAX_LIST_ITEMS = 20;
/** The most bytes the stored changes may take, as app.audit_event checks. */
const MAX_CHANGES_BYTES = 65_536;

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
 * The changes as stored: `{ before, after }` when the field and both values
 * may be kept, and `{}` otherwise. Refuses a key that is not a classified
 * column or a form field id, so no value can be passed as a key.
 */
export function keptChanges(changes: AuditChanges): Record<string, FieldChange> {
  return Object.fromEntries(
    Object.entries(changes).map(([field, { before, after }]) => [
      field,
      mayKeepValues(field) && [before, after].every(isKeptValue) ? { before, after } : {},
    ]),
  );
}

const isPrimitive = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Left out, a primitive, or a list of at most MAX_LIST_ITEMS primitives. */
function isKeptValue(value: unknown): boolean {
  if (value === undefined || isPrimitive(value)) return true;
  return Array.isArray(value) && value.length <= MAX_LIST_ITEMS && value.every(isPrimitive);
}

function mayKeepValues(field: string): boolean {
  if (FORM_FIELD_ID.test(field)) return false;
  const [, table = '', name = ''] = COLUMN_FIELD_ID.exec(field) ?? [];
  const fields = Object.hasOwn(classification, table) ? classification[table] : undefined;
  const column = fields && Object.hasOwn(fields, name) ? fields[name] : undefined;
  if (!column) {
    throw new Error('Audit changes are keyed by a classified column id or a form field id.');
  }
  if (notKept.has(field)) return false;
  return column.sensitivity === 'public' || column.sensitivity === 'internal';
}

/**
 * Insert one event in the transaction's tenant. The database sets its id,
 * occurred_at, retain_until and actor_member_kind.
 */
export async function insertAuditEvent<DB>(
  trx: Transaction<DB>,
  row: AuditEventRow,
): Promise<void> {
  const changes = JSON.stringify(keptChanges(row.changes));
  if (Buffer.byteLength(changes) > MAX_CHANGES_BYTES) {
    throw new Error('Audit changes are larger than 65,536 bytes.');
  }
  await sql`
    INSERT INTO app.audit_event
      (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id, changes)
    VALUES (app.current_tenant_id(), ${row.requestId}, ${row.actorKind}, ${row.actorId},
            ${row.action}, ${row.entityType}, ${row.entityId}, ${changes}::jsonb)
  `.execute(trx);
}
