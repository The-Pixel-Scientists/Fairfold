// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Record-level reach (ADR 0037): which restrictable records a member may
// reach inside their tenant. One predicate per rule backs both the detail
// resolvers and the shared list filter, so a list can never show a record its
// detail route refuses.
//
//   reachable  a record that is not restricted, or is restricted and has an
//              `assigned` or `named` access row for the member or one of
//              their current teams. On a record's own read routes only, an
//              unexpired break-glass grant of the member counts too.
//   caseload   a record with an `assigned` row for the member or a team.
//
// Teams give reach and nothing else. The member always comes from the
// policy's verified membership, never from request input. Grants are read
// against the database's clock: `expires_at` is compared with now() in SQL.

import type { ExpressionBuilder } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';
import type { RouteContract } from '@pixel-scientists/domain/api';
import { reachScopeRules } from '@pixel-scientists/domain/platform';

import type { PolicyContext } from '../context.ts';
import type { ScopeResolver, ScopeResolvers } from './scopes.ts';

export type ReachRule = (typeof reachScopeRules)[number];

/** What a module tells the platform about one restrictable record type. */
export interface ReachDescriptor {
  /** The record type, as the route contract names it, such as `cases.case`. */
  readonly record: string;
  /** The record's table, with an `id` and a `restricted` column. Lists select from it unaliased. */
  readonly table: string;
  /** The module's access table: `kind`, `membership_id`, `team_id`, `break_glass_id` and the record's id. */
  readonly access: { readonly table: string; readonly recordColumn: string };
  /** The route parameter that holds the record's id. */
  readonly param: string;
  /** Routes ("GET /path") that create the record itself, which neither list nor name one. */
  readonly creates?: readonly string[];
}

const TABLE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;
const COLUMN = /^[a-z][a-z_]*$/;
const PARAM = /^[a-z][A-Za-z0-9]*$/;

/** A descriptor with its identifiers checked, since they are put into queries. */
export function reachDescriptor(descriptor: ReachDescriptor): ReachDescriptor {
  const ok =
    TABLE.test(descriptor.table) &&
    TABLE.test(descriptor.access.table) &&
    COLUMN.test(descriptor.access.recordColumn) &&
    PARAM.test(descriptor.param);
  if (!ok) throw new Error(`The reach descriptor for ${descriptor.record} is not valid.`);
  return descriptor;
}

/** Any table: the descriptor names them, so Kysely cannot type them. */
type ReachDb = Record<string, Record<string, unknown>>;
type Eb = ExpressionBuilder<ReachDb, string>;

/**
 * The one reach predicate, on the record's table named in the descriptor. A
 * live break-glass grant counts only with `withBreakGlass`, which only a
 * record's own read routes pass.
 */
function predicate(
  eb: Eb,
  { table, access }: ReachDescriptor,
  member: string,
  rule: ReachRule,
  withBreakGlass: boolean,
) {
  const column = (name: string) => `${access.table}.${name}`;
  const named = eb.exists(
    eb
      .selectFrom(access.table)
      .select((a) => a.lit(1).as('one'))
      .where((a) =>
        a.and([
          a(column(access.recordColumn), '=', a.ref(`${table}.id`)),
          a.or([
            a(column('kind'), 'in', rule === 'caseload' ? ['assigned'] : ['assigned', 'named']),
            ...(withBreakGlass && rule === 'reachable'
              ? [
                  a.and([
                    a(column('kind'), '=', 'break_glass'),
                    a.exists(
                      a
                        .selectFrom('app.break_glass')
                        .select((g) => g.lit(1).as('one'))
                        .whereRef('app.break_glass.id', '=', column('break_glass_id'))
                        .where('app.break_glass.membership_id', '=', member)
                        .where('app.break_glass.expires_at', '>', a.fn<Date>('now')),
                    ),
                  ]),
                ]
              : []),
          ]),
          a.or([
            a(column('membership_id'), '=', member),
            a(
              column('team_id'),
              'in',
              a
                .selectFrom('app.team_member')
                .innerJoin('app.team', (join) =>
                  join
                    .onRef('app.team.tenant_id', '=', 'app.team_member.tenant_id')
                    .onRef('app.team.id', '=', 'app.team_member.team_id'),
                )
                .select('app.team_member.team_id')
                .where('app.team_member.membership_id', '=', member)
                .where('app.team_member.removed_at', 'is', null)
                .where('app.team.archived_at', 'is', null),
            ),
          ]),
        ]),
      ),
  );
  return rule === 'reachable' ? eb.or([eb(`${table}.restricted`, '=', false), named]) : named;
}

/** Callers that have taken a filter, so a test can tell a list that never asked for one. */
const filtered = new WeakSet<object>();

/** Whether `caller`'s request has built a reach filter. */
export const reachFilterUsed = (caller: Pick<PolicyContext, 'membership'>): boolean =>
  filtered.has(caller.membership);

/**
 * The reach condition for a list, search, count or export of `descriptor`'s
 * records, for the policy's member: `query.where((eb) => reachFilter(eb, ...))`.
 * Counts and totals come from the same filtered query. Break-glass never
 * counts here, so an emergency grant cannot become a bulk read.
 */
export function reachFilter<DB, TB extends keyof DB & string>(
  eb: ExpressionBuilder<DB, TB>,
  caller: Pick<PolicyContext, 'membership'>,
  descriptor: ReachDescriptor,
  rule: ReachRule,
) {
  filtered.add(caller.membership);
  return predicate(eb, descriptor, caller.membership.id, rule, false);
}

const isReachRule = (rule: string): rule is ReachRule =>
  (reachScopeRules as readonly string[]).includes(rule);

/**
 * The resolvers of `reachable` and `caseload`, for the descriptors every
 * module registers. A route that names a record with no descriptor reaches
 * nothing, and a route with no id parameter is a list or a create, left to its
 * handler. With no descriptor, no resolver is registered, so a route using a
 * reach rule stops start-up.
 */
export function reachResolvers(descriptors: readonly ReachDescriptor[]): ScopeResolvers {
  if (descriptors.length === 0) return {};
  const byRecord = new Map(descriptors.map((d) => [d.record, d]));
  const resolver =
    (rule: ReachRule): ScopeResolver =>
    async ({ tx, membershipId, input, method, record }) => {
      const descriptor = record === undefined ? undefined : byRecord.get(record);
      if (descriptor === undefined) return false;
      const params = (input.params ?? {}) as Record<string, unknown>;
      if (!(descriptor.param in params)) return true;
      const id = idSchema.safeParse(params[descriptor.param]);
      if (!id.success) return false;
      const found = await tx
        .$extendTables<ReachDb>()
        .selectFrom(descriptor.table)
        .select((eb) => eb.lit(1).as('one'))
        .where(`${descriptor.table}.id`, '=', id.data)
        .where((eb) => predicate(eb, descriptor, membershipId, rule, method === 'GET'))
        .executeTakeFirst();
      return found !== undefined;
    };
  return { reachable: resolver('reachable'), caseload: resolver('caseload') };
}

interface ContractRoute {
  readonly contract: RouteContract;
}

const isReach = (route: ContractRoute): boolean =>
  route.contract.scope !== null && isReachRule(route.contract.scope);

/**
 * The routes on a reach rule that list, search, count or export records:
 * those with no id parameter that are not the record's own create route. Each
 * handler must build the shared filter. Throws for a route naming a record
 * with no descriptor, so a missing registration stops start-up.
 */
export function listRoutes(
  routes: readonly ContractRoute[],
  descriptors: readonly ReachDescriptor[],
): ContractRoute[] {
  const byRecord = new Map(descriptors.map((d) => [d.record, d]));
  return routes.filter(isReach).filter(({ contract }) => {
    // Read wide: no module has a restrictable record yet, so the contract's own type is empty.
    const { record } = contract as { record?: string };
    const descriptor = record === undefined ? undefined : byRecord.get(record);
    const id = `${contract.method} ${contract.path}`;
    if (descriptor === undefined) throw new Error(`${id} names a record with no descriptor.`);
    return !contract.path.includes(`:${descriptor.param}`) && !descriptor.creates?.includes(id);
  });
}
