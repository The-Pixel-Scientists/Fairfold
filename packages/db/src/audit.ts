// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one insert into app.audit_event (architecture rule 4). The tenant
// comes from the transaction, and each change keeps its values only when
// the classification map marks the field public or internal and not
// structured or free text (D12), and each value is a string, number,
// boolean or null, or a short list of them. A theme's logo and tokens are
// recorded by a derived value of a checked shape, never the stored bytes or
// document. Any other change, and every form field, is recorded by its id
// alone. A key that is neither a
// classified column nor a form field id is refused, and so are changes over
// 64 KiB. The audit writer in apps/api/src/audit checks the action and the
// actor before calling this; the database records the actor's member kind.

import { tokenPaths } from '@pixel-scientists/domain/platform';
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
/** A SHA-256 digest in lower-case hex. */
const SHA256_HEX = /^[0-9a-f]{64}$/;
const TOKEN_PATHS: ReadonlySet<string> = new Set(tokenPaths);

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
  /** The party the event is about, in the same tenant (ADR 0027). */
  readonly subjectPartyId?: string | null;
  /** The job that wrote a `system` event (ADR 0009); only app_worker may name one. */
  readonly job?: AuditJob;
}

interface AuditJob {
  readonly jobId: string;
  /** The membership whose request caused the job, in the same tenant, if any. */
  readonly originMembershipId: string | null;
}

/**
 * The changes as stored: `{ before, after }` when the field and both values
 * may be kept, and `{}` otherwise. Refuses a key that is not a classified
 * column or a form field id, so no value can be passed as a key.
 */
export function keptChanges(changes: AuditChanges): Record<string, FieldChange> {
  return Object.fromEntries(
    Object.entries(changes).map(([field, { before, after }]) => {
      const isKept = keptValueCheck(field);
      return [field, isKept && [before, after].every(isKept) ? { before, after } : {}];
    }),
  );
}

/**
 * Structured columns recorded by a derived value, never their own: a logo by
 * its SHA-256 digest, and theme tokens by the changed token paths and their
 * values, or by the marker for stored tokens that no longer pass.
 */
const derivedValues: Readonly<Record<string, (value: unknown) => boolean>> = {
  'app.tenant_theme.logo': (value) => typeof value === 'string' && SHA256_HEX.test(value),
  'app.tenant_theme.tokens': (value) => value === 'unusable' || isTokenMap(value),
};

/** The check a field's values must pass to be kept, or null if they never are. */
function keptValueCheck(field: string): ((value: unknown) => boolean) | null {
  if (!mayKeepValues(field)) return null;
  const derived = Object.hasOwn(derivedValues, field) ? derivedValues[field] : undefined;
  if (derived) return (value) => value === undefined || value === null || derived(value);
  return notKept.has(field) ? null : isKeptValue;
}

/** A plain object from known token paths to strings, numbers or null. */
function isTokenMap(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(
    ([path, token]) =>
      TOKEN_PATHS.has(path) &&
      (token === null || typeof token === 'string' || typeof token === 'number'),
  );
}

const isPrimitive = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Left out, a primitive, or a list of at most MAX_LIST_ITEMS primitives. */
function isKeptValue(value: unknown): boolean {
  if (value === undefined || isPrimitive(value)) return true;
  return Array.isArray(value) && value.length <= MAX_LIST_ITEMS && value.every(isPrimitive);
}

/** Whether the field is a classified public or internal column. */
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
 * occurred_at, retain_until and actor_member_kind, and refuses a subject
 * party or originating membership from another tenant. The job columns are
 * named only for a job's event, as app_api may not insert them.
 */
export async function insertAuditEvent<DB>(
  trx: Transaction<DB>,
  row: AuditEventRow,
): Promise<void> {
  const changes = JSON.stringify(keptChanges(row.changes));
  if (Buffer.byteLength(changes) > MAX_CHANGES_BYTES) {
    throw new Error('Audit changes are larger than 65,536 bytes.');
  }
  if (row.job && row.actorKind !== 'system') {
    throw new Error('Only a system event names a job.');
  }
  const jobColumns = row.job ? sql`, job_id, origin_membership_id` : sql``;
  const jobValues = row.job ? sql`, ${row.job.jobId}, ${row.job.originMembershipId}` : sql``;
  await sql`
    INSERT INTO app.audit_event
      (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id, changes,
       subject_party_id${jobColumns})
    VALUES (app.current_tenant_id(), ${row.requestId}, ${row.actorKind}, ${row.actorId},
            ${row.action}, ${row.entityType}, ${row.entityId}, ${changes}::jsonb,
            ${row.subjectPartyId ?? null}${jobValues})
  `.execute(trx);
}
