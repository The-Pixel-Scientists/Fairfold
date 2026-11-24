// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a module is composed from, and what it gives back (ADR 0016). Each
// file beside this one exports a `ModuleFactory`: the platform's dependencies
// in, a composition out. A module's wiring edits its own file and nothing
// shared, and apps/api/src/modules.ts merges the compositions and stops
// start-up on a name two of them define.

import type { Kysely } from '@pixel-scientists/db';
import type { JobSender } from '@pixel-scientists/db/jobs';
import type { FieldProblem } from '@pixel-scientists/domain/platform';
import type { MailSender } from '@pixel-scientists/grants/server';
import type { RepointParty } from '@pixel-scientists/party/contracts';
import type { SubjectRule } from '@pixel-scientists/party/server';

import type { ModuleSettings } from '../config.ts';
import type { InTenant, PublicTenants, TenantTransaction } from '../database.ts';
import type { CounterStore, UploadCounters } from '../limits/store.ts';
import type { insertConfigVersion, readConfigHistory } from '../platform/config-versions.ts';
import type { FileService } from '../platform/files/index.ts';
import type { membersWith } from '../platform/members.ts';
import type { notesPlatform } from '../platform/notes/index.ts';
import type { Contribution as ErasureContribution } from '../platform/erasure/index.ts';
import type { Contribution as SubjectDataContribution } from '../platform/subject-access/index.ts';
import type { Contribution as WarehouseContribution } from '../platform/warehouse/snapshot.ts';
import type { ScopeResolvers } from '../policy/index.ts';
import type { PublicLog } from '../public/tenants.ts';
import type { Route } from '../routes/register.ts';
import type { ModuleJob } from '../worker/registry.ts';

/** What a module that sends email needs: the sender, and the portal origin its emails link to. */
export interface Mail {
  readonly sender: MailSender;
  readonly portalOrigin: string;
}

/** The API's pool and counters, for what a module reads or counts outside a tenant transaction. */
export interface ModuleDatabase {
  readonly inTenant: InTenant;
  /** The `app_api` pool with no tenant set, for the approved functions the public routes call. */
  readonly pool: Kysely<unknown>;
  readonly requestLimits: CounterStore & UploadCounters;
}

/** Outbound requests (ADR 0010): both refuse anything the address policy refuses. */
export interface Outbound {
  /** The global `fetch`, looked up on each call, through the dispatcher installed at start. */
  readonly fetch: typeof fetch;
  /** `fetch` for one configured endpoint, pinned to its host and port. */
  readonly pinned: (endpoint: URL) => typeof fetch;
}

/** The helpers the platform gives every module's handlers. */
export interface PlatformHelpers {
  /** A record the caller may not reach reads exactly as a missing one does. */
  readonly notFound: () => Error;
  readonly missing: () => never;
  /** A request the caller can fix or retry, in words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]) => Error;
  readonly forbidden: () => Error;
  readonly slowDown: (retryAfterSeconds: number) => Error;
  /** The id a replay reads by; a route whose first answer had none has nothing to replay. */
  readonly created: (id: string | null) => string;
  readonly tenantTimeZone: (tx: TenantTransaction, tenant: string) => Promise<string>;
  readonly recordConfig: typeof insertConfigVersion;
  readonly configHistory: typeof readConfigHistory;
  readonly membersWith: typeof membersWith;
  readonly notes: typeof notesPlatform;
}

/** Everything the platform gives a module. The worker passes the same, and the parts it has no use for fail when used. */
export interface ModuleDependencies {
  readonly database: ModuleDatabase;
  readonly publicTenants: PublicTenants;
  /** The job sender, for the jobs a request queues (ADR 0009). */
  readonly jobs: JobSender;
  readonly files: FileService;
  readonly mail: Mail;
  readonly outbound: Outbound;
  readonly settings: ModuleSettings;
  readonly platform: PlatformHelpers;
  readonly log: PublicLog | undefined;
}

/** What one module adds to the platform. Each list may be left out. */
export interface ModuleComposition {
  readonly routes?: readonly Route[];
  /** Scope rule resolvers, by rule id. */
  readonly resolvers?: ScopeResolvers;
  /** The worker's handlers, attached whether or not any tenant has the module on. */
  readonly jobs?: readonly ModuleJob[];
  readonly erasure?: readonly ErasureContribution[];
  readonly warehouse?: readonly WarehouseContribution[];
  /** Refused by `mergeCompositions` until the platform reads it: the subject access walk's contribution. */
  readonly subjectData?: readonly SubjectDataContribution[];
  /** The module's entry in the party merge's re-points. */
  readonly repoints?: readonly RepointParty<TenantTransaction>[];
  /** The audit log's rules for the party an event is about, by action. */
  readonly subjectRules?: Readonly<Record<string, SubjectRule>>;
}

export type ModuleFactory = (deps: ModuleDependencies) => ModuleComposition;
