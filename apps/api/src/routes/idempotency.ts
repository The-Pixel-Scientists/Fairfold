// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Idempotency keys for create routes (ADR 0028). The key is reserved inside
// the request's tenant transaction, after the policy check and before the
// handler. A repeat of the same request answers what the route's replay
// reader reads now; the same key with another request is refused. Nothing
// but the hash, status and created id is stored: never a body or a value.

import { createHash } from 'node:crypto';

import { setLocalLockTimeout, type Generated } from '@pixel-scientists/db';
import { idempotencyProblems } from '@pixel-scientists/domain/api';
import { messages } from '@pixel-scientists/domain/platform';

import type { TenantTransaction } from '../database.ts';
import { ApiError, type ProblemKind } from '../problems.ts';

type KeyTables = {
  'app.idempotency_key': {
    id: Generated<string>;
    tenant_id: string;
    membership_id: string;
    route_id: string;
    key: string;
    request_hash: Buffer;
    state: Generated<'in_progress' | 'completed'>;
    status: number | null;
    created_id: string | null;
  };
};

/** SQLSTATE when a statement gives up waiting for a lock. */
const LOCK_NOT_AVAILABLE = '55P03';

const inProgress = (): ApiError =>
  problem(idempotencyProblems.inProgress, messages.keyInProgress, 'key_in_progress', {
    'Retry-After': String(idempotencyProblems.inProgress.retryAfterSeconds),
  });

const reused = (): ApiError =>
  problem(idempotencyProblems.reused, messages.keyReused, 'key_reused');

function problem(
  { type, status, title }: ProblemKind & { status: number },
  detail: string,
  reason: string,
  headers?: Record<string, string>,
): ApiError {
  return new ApiError(status, detail, {
    reason,
    kind: { type, title },
    ...(headers === undefined ? {} : { headers }),
  });
}

/** The value with object members sorted at every level and bytes as their digest. */
function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return createHash('sha256').update(value).digest('hex');
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  const { toJSON } = value as { toJSON?: () => unknown };
  if (typeof toJSON === 'function') return canonical(toJSON.call(value));
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonical(record[key])]),
  );
}

/** SHA-256 of the route and its validated parts, so key order and spacing change nothing. */
export function requestHash(
  routeId: string,
  input: { readonly params: unknown; readonly query: unknown; readonly body: unknown },
): Buffer {
  const { params, query, body } = input;
  const request = canonical({
    route: routeId,
    params: params ?? null,
    query: query ?? null,
    body: body ?? null,
  });
  return createHash('sha256').update(JSON.stringify(request), 'utf8').digest();
}

export interface Reservation {
  readonly membershipId: string;
  readonly routeId: string;
  readonly key: string;
  readonly hash: Buffer;
  /** The success status of the route. */
  readonly status: number;
}

const createdId = (body: unknown): string | null => {
  const id = (body as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' ? id : null;
};

/**
 * Runs `create` once for the key, or replays. Any error from `create` rolls
 * the transaction back, reservation included, so the key is free to retry.
 */
export async function withIdempotencyKey<T>(
  tx: TenantTransaction,
  { membershipId, routeId, key, hash, status }: Reservation,
  create: () => Promise<T>,
  replay: (createdId: string | null) => Promise<T>,
): Promise<T> {
  const db = tx.$extendTables<KeyTables>();

  // A second insert of the same key waits here for the first transaction to end.
  await setLocalLockTimeout(tx, '5s');
  let reserved: { id: string } | undefined;
  try {
    reserved = await db
      .insertInto('app.idempotency_key')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        membership_id: membershipId,
        route_id: routeId,
        key,
        request_hash: hash,
      }))
      .onConflict((oc) => oc.columns(['tenant_id', 'membership_id', 'route_id', 'key']).doNothing())
      .returning('id')
      .executeTakeFirst();
  } catch (error) {
    if ((error as { code?: unknown }).code === LOCK_NOT_AVAILABLE) throw inProgress();
    throw error;
  }
  await setLocalLockTimeout(tx, 'default');

  if (reserved !== undefined) {
    const body = await create();
    await db
      .updateTable('app.idempotency_key')
      .set({ state: 'completed', status, created_id: createdId(body) })
      .where('id', '=', reserved.id)
      .execute();
    return body;
  }

  const stored = await db
    .selectFrom('app.idempotency_key')
    .select(['request_hash', 'state', 'created_id'])
    .where('tenant_id', '=', (eb) => eb.fn<string>('app.current_tenant_id', []))
    .where('membership_id', '=', membershipId)
    .where('route_id', '=', routeId)
    .where('key', '=', key)
    .executeTakeFirst();
  if (stored === undefined || stored.state !== 'completed') throw inProgress();
  if (!stored.request_hash.equals(hash)) throw reused();
  return replay(stored.created_id);
}
