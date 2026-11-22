// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The disclosure rule (ADR 0032): the threshold and minimum group a tenant
// applies to equality monitoring reports. A tenant without a row has the
// platform floor, and no rule applies less than it, whatever a row holds.
// The platform has already checked the permission and, for a change, step-up.

import type { AuditChanges } from '@pixel-scientists/db';

import {
  disclosureFloor,
  type AppliedDisclosureRule,
  type DisclosureRule,
  type DisclosureRuleInput,
} from '../contracts/index.ts';
import {
  insightDb,
  isTaken,
  iso,
  type Args,
  type DisclosureChange,
  type InsightDependencies,
  type Tx,
} from './context.ts';
import { serverRefusals } from './messages.ts';

const columns = ['id', 'threshold', 'minimum_group', 'version', 'updated_at'] as const;

const readRule = (tx: Tx, lock: boolean) => {
  const query = insightDb(tx).selectFrom('insight.disclosure_rule').select(columns);
  return (lock ? query.forUpdate() : query).executeTakeFirst();
};

/** The rule a report applies: the tenant's row, never below the platform floor. */
export function applied(
  row: { version: number; threshold: number; minimum_group: number } | undefined,
): AppliedDisclosureRule {
  return {
    version: row?.version ?? null,
    threshold: Math.max(row?.threshold ?? 0, disclosureFloor.threshold),
    minimumGroup: Math.max(row?.minimum_group ?? 0, disclosureFloor.minimumGroup),
  };
}

export async function appliedRule(tx: Tx): Promise<AppliedDisclosureRule> {
  return applied(await readRule(tx, false));
}

export function disclosureHandlers(deps: InsightDependencies) {
  async function getDisclosureRule({ tx }: Args<unknown>): Promise<DisclosureRule> {
    const row = await readRule(tx, false);
    return { ...applied(row), updatedAt: row === undefined ? null : iso(row.updated_at) };
  }

  async function updateDisclosureRule({
    tx,
    context,
    input,
  }: Args<{ body: DisclosureRuleInput }>): Promise<DisclosureRule> {
    const { threshold, minimumGroup } = input.body;
    const db = insightDb(tx);
    const actor = context.membership.id;
    const found = await readRule(tx, true);

    // A first rule records both values against the floor; a change records only what moved.
    const before = {
      threshold: found?.threshold ?? disclosureFloor.threshold,
      minimumGroup: found?.minimum_group ?? disclosureFloor.minimumGroup,
    };
    const moves: DisclosureChange[] = [
      { field: 'threshold', from: before.threshold, to: threshold },
      { field: 'minimumGroup', from: before.minimumGroup, to: minimumGroup },
    ];
    const diff = found === undefined ? moves : moves.filter(({ from, to }) => from !== to);
    if (found !== undefined && diff.length === 0) return getDisclosureRule({ tx, context, input });

    let id: string;
    if (found === undefined) {
      try {
        ({ id } = await db
          .insertInto('insight.disclosure_rule')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            threshold,
            minimum_group: minimumGroup,
            created_by: actor,
            updated_by: actor,
          }))
          .returning('id')
          .executeTakeFirstOrThrow());
      } catch (error) {
        throw isTaken(error) ? deps.refuse(409, serverRefusals.changedElsewhere) : error;
      }
    } else {
      id = found.id;
      await db
        .updateTable('insight.disclosure_rule')
        .set({
          threshold,
          minimum_group: minimumGroup,
          version: found.version + 1,
          updated_by: actor,
        })
        .where('id', '=', id)
        .execute();
    }

    await context.config.record('insight.disclosure_rule', id, diff);
    const changes: AuditChanges = Object.fromEntries(
      diff.map(({ field, from, to }) => [
        `insight.disclosure_rule.${field === 'threshold' ? 'threshold' : 'minimum_group'}`,
        { before: from, after: to },
      ]),
    );
    await context.audit.record({
      action: 'insight.disclosure_rule.changed',
      entityId: id,
      changes,
    });
    return getDisclosureRule({ tx, context, input });
  }

  return { getDisclosureRule, updateDisclosureRule };
}
