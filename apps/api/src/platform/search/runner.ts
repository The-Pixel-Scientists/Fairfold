// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The search fan-out (ADR 0025, ADR 0016): one term, every provider whose
// module is on for the tenant and whose permission the caller holds, one
// after another in the request's own tenant transaction. A provider is given
// the term, the audience and a limit, never a tenant, a member or a
// permission, and matches only on the fields searchableFields() allows that
// audience. Each group is cut at the contract's cap and the whole answer at
// SEARCH_TOTAL_LIMIT. The answer is checked against the audience's response
// schema before it leaves, so a provider that returns more than its audience
// may see is refused, not filtered. Results of a provider that names a read
// action are audited here, with ids only: never the term, never a label.

import {
  moduleOn,
  type AuditAction,
  type ModuleId,
  type Permission,
} from '@pixel-scientists/domain/platform';
import {
  searchResponseSchemas,
  SEARCH_GROUP_LIMIT,
  type SearchAudience,
  type SearchFunction,
  type SearchHit,
  type SearchProvider,
  type SearchResponse,
  type SearchTerm,
} from '@pixel-scientists/domain/platform/search';

import type { RequestAudit } from '../../context.ts';
import type { TenantTransaction } from '../../database.ts';

/** The most results in one answer, over every group. */
export const SEARCH_TOTAL_LIMIT = 30;

/** A module's provider, and the search that runs it in a request's transaction. */
export interface SearchEntry {
  readonly provider: SearchProvider;
  readonly search: (tx: TenantTransaction) => SearchFunction;
}

export interface SearchRun {
  readonly tx: TenantTransaction;
  readonly permissions: ReadonlySet<Permission>;
  readonly audit: RequestAudit;
  readonly term: SearchTerm;
  /** Only these modules, when given. */
  readonly modules?: readonly ModuleId[];
  readonly entries: readonly SearchEntry[];
}

type SwitchTables = { 'app.tenant_module': { module: string; enabled: boolean } };

/** Round-robin, so one kind of record cannot crowd out another in a group. */
function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const merged: T[] = [];
  for (let at = 0; lists.some((list) => at < list.length); at++) {
    for (const list of lists) if (at < list.length) merged.push(list[at] as T);
  }
  return merged;
}

const refused = (): Error =>
  new Error('A search provider returned a result its audience may not see.');

export async function runSearch(run: SearchRun): Promise<SearchResponse> {
  const { tx, permissions, audit, term } = run;
  const switches = await tx
    .$extendTables<SwitchTables>()
    .selectFrom('app.tenant_module')
    .select(['module', 'enabled'])
    .execute();
  const stored = new Map(switches.map((row) => [row.module, row.enabled]));

  // A missing row is off (ADR 0024).
  const held = run.entries.filter(
    ({ provider }) =>
      moduleOn(provider.module, stored.get(provider.module)) &&
      permissions.has(provider.permission),
  );
  // Review is blind in v1, so a caller with only reviewer providers searches as a blind reviewer.
  const staff = held.some(({ provider }) => provider.audiences.includes('staff'));
  const audience: SearchAudience = !staff && held.length > 0 ? 'blind_reviewer' : 'staff';
  const eligible = held.filter(
    ({ provider }) =>
      provider.audiences.includes(audience) &&
      (run.modules === undefined || run.modules.includes(provider.module)),
  );

  const byModule = new Map<ModuleId, { provider: SearchProvider; hits: SearchHit[] }[]>();
  for (const { provider, search } of eligible) {
    const hits = await search(tx)({ term, audience, limit: SEARCH_GROUP_LIMIT + 1 });
    if (hits.some((hit) => hit.kind !== provider.kind || hit.module !== provider.module)) {
      throw refused();
    }
    byModule.set(provider.module, [
      ...(byModule.get(provider.module) ?? []),
      { provider, hits: [...hits] },
    ]);
  }

  let room = SEARCH_TOTAL_LIMIT;
  const groups = [...byModule].flatMap(([module, found]) => {
    const merged = interleave(found.map(({ hits }) => hits));
    const kept = merged.slice(0, Math.min(SEARCH_GROUP_LIMIT, room));
    room -= kept.length;
    return merged.length === 0 ? [] : [{ module, hits: kept, more: merged.length > kept.length }];
  });

  const response =
    audience === 'staff'
      ? {
          audience,
          groups: groups.map(({ module, hits, more }) => ({
            module,
            results: hits.map(({ kind, id, label }) => ({ kind, id, label })),
            more,
          })),
        }
      : {
          audience,
          groups: groups.map(({ module, hits, more }) => ({
            module,
            // A blind reviewer's label is the application's reference and nothing else.
            results: hits.map(({ kind, id, label }) => ({ kind, id, reference: label })),
            more,
          })),
        };
  const checked = searchResponseSchemas[audience].safeParse(response);
  if (!checked.success) throw refused();

  const actions = new Map<string, AuditAction | undefined>(
    eligible.map(({ provider }) => [provider.kind, provider.readAction]),
  );
  for (const { hits } of groups) {
    for (const { kind, id } of hits) {
      const action = actions.get(kind);
      if (action !== undefined) await audit.read({ action, entityId: id });
    }
  }
  return checked.data;
}
