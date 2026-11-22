// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The registry refresh job (ADR 0009, ADR 0031). apps/api defines the tenant
// queue `assure.registry_refresh`, whose payload is ids and enums only, and
// passes in what the job needs from it, since module code reaches neither
// the queue helpers nor the worker. Two payloads reach it:
// `{ organisationId, registry }` refreshes one identifier, queued by staff or
// by the scan; `{ slot }` is the platform fan-out's per-tenant scan, which
// queues a refresh for each snapshot past its age. The job re-reads the
// identifier through party's server, calls the adapter, and inserts a
// snapshot, and ends with `precondition_failed` (no retry) before any call
// when the organisation has been erased. It never links, verifies or changes
// a party, and never decides anything about an application.

import type { AuditChanges, Transaction } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';
import { organisationSummaries } from '@pixel-scientists/party/server';

import {
  registries,
  registryIds,
  registrySchema,
  type LookupFailure,
  type Registry,
} from '../../contracts/index.ts';
import type { RegistryAdapters } from './adapters.ts';
import {
  assureIsOn,
  insertSnapshot,
  organisationIsErased,
  refreshRecorded,
  staleLookups,
} from './store.ts';

type Tx = Transaction<unknown>;

export const REFRESH_QUEUE = 'assure.registry_refresh';

/** A snapshot older than this is looked up again (ADR 0031). */
export const STALE_DAYS = 30;
/** The most refreshes one scan queues, so a tenant cannot use a register's whole allowance. */
export const SCAN_LIMIT = 50;

/** The codes a failed job ends with: the worker's closed list, never a message. */
export type RefreshFailureCode =
  'invalid_payload' | 'precondition_failed' | 'not_found' | 'internal';

/** The running job, as the worker's wrapper gives it. */
export interface RefreshJob {
  readonly id: string;
  readonly data: unknown;
  /** The job's request id, and the member whose request caused it (for the trail only). */
  readonly context: { readonly requestId: string; readonly causingUserId: string | null };
}

/** An event the job records as the system, for the member whose request caused it. */
export interface RefreshAuditEvent {
  readonly action: 'assure.lookup.refreshed';
  readonly entityId: string;
  readonly subjectPartyId: string;
  readonly changes: AuditChanges;
}

/** What queues one refresh in the caller's transaction: the id of the job, or null when none was queued. */
export type QueueRefresh = (
  tx: Tx,
  data: { readonly organisationId: string; readonly registry: Registry },
  by: { readonly requestId: string; readonly causingUserId: string | null },
) => Promise<string | null>;

export interface RefreshDependencies {
  readonly adapters: RegistryAdapters;
  readonly queueRefresh: QueueRefresh;
  /** Writes an audit event as the job: the system, with the job id and originating member. */
  readonly audit: (tx: Tx, job: RefreshJob, event: RefreshAuditEvent) => Promise<void>;
  /** The error that ends the job with `code`. */
  readonly fail: (code: RefreshFailureCode) => Error;
  /** The clock the scan measures a snapshot's age by; the process's own when left out. */
  readonly now?: () => Date;
}

/** What each failure that stores nothing does to the job: unavailable and rate limited are tried again. */
const failureCodes: Readonly<Record<Exclude<LookupFailure, 'not_found'>, RefreshFailureCode>> = {
  not_set_up: 'precondition_failed',
  response_refused: 'precondition_failed',
  registry_unavailable: 'internal',
  rate_limited: 'internal',
};

type Payload =
  | { readonly kind: 'refresh'; readonly organisationId: string; readonly registry: Registry }
  | { readonly kind: 'scan' };

/** The payload as one of the two shapes, or null. */
function payloadOf(data: unknown): Payload | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { slot, organisationId, registry, ...extra } = data as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return null;
  if (slot !== undefined) {
    return organisationId === undefined &&
      registry === undefined &&
      idSchema.safeParse(slot).success
      ? { kind: 'scan' }
      : null;
  }
  const id = idSchema.safeParse(organisationId);
  const register = registrySchema.safeParse(registry);
  return id.success && register.success
    ? { kind: 'refresh', organisationId: id.data, registry: register.data }
    : null;
}

async function refresh(
  tx: Tx,
  job: RefreshJob,
  deps: RefreshDependencies,
  organisationId: string,
  registry: Registry,
): Promise<void> {
  if (await refreshRecorded(tx, job.id)) return;
  if (await organisationIsErased(tx, organisationId)) throw deps.fail('precondition_failed');
  const [organisation] = await organisationSummaries(tx, [organisationId]);
  if (organisation === undefined) throw deps.fail('not_found');
  const identifier = organisation.identifiers.find(
    (claimed) => claimed.scheme === registries[registry],
  )?.identifier;
  const adapter = deps.adapters[registry];
  if (identifier === undefined) throw deps.fail('precondition_failed');
  if (adapter === undefined) throw deps.fail(failureCodes.not_set_up);
  const outcome = await adapter.lookUp(identifier);
  if (!outcome.ok && outcome.failure !== 'not_found') {
    throw deps.fail(failureCodes[outcome.failure]);
  }
  const id = await insertSnapshot(
    tx,
    organisationId,
    registry,
    identifier,
    outcome.ok ? outcome.result : null,
  );
  await deps.audit(tx, job, {
    action: 'assure.lookup.refreshed',
    entityId: id,
    subjectPartyId: organisationId,
    changes: {
      'assure.lookup_snapshot.registry': { after: registry },
      'assure.lookup_snapshot.outcome': { after: outcome.ok ? 'found' : 'not_found' },
    },
  });
}

async function scan(tx: Tx, job: RefreshJob, deps: RefreshDependencies): Promise<void> {
  const reachable = registryIds.filter((registry) => deps.adapters[registry] !== undefined);
  const now = deps.now?.() ?? new Date();
  const before = new Date(now.getTime() - STALE_DAYS * 86_400_000);
  for (const lookup of await staleLookups(tx, reachable, before, SCAN_LIMIT)) {
    await deps.queueRefresh(tx, lookup, job.context);
  }
}

/**
 * The worker's handler for `assure.registry_refresh`. With assure off for the
 * tenant it does nothing, since the module keeps its data but is not working.
 * A failure ends the job with a code from the closed list and stores nothing,
 * so the last good snapshot stays; a job delivered twice stores one snapshot.
 */
export function registryRefresh(deps: RefreshDependencies) {
  return async (tx: Tx, job: RefreshJob): Promise<void> => {
    const payload = payloadOf(job.data);
    if (payload === null) throw deps.fail('invalid_payload');
    if (!(await assureIsOn(tx))) return;
    if (payload.kind === 'scan') await scan(tx, job, deps);
    else await refresh(tx, job, deps, payload.organisationId, payload.registry);
  };
}
