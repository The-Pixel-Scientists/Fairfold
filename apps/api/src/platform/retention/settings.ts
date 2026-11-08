// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How long each kind of data is kept (ADR 0003, rule 5). A tenant with no
// row keeps the platform minimum. A change writes the setting, a
// configuration version and `platform.retention_policy.changed` in one
// transaction. It takes effect at the next nightly sweep, and a changed audit
// period applies only to events written afterwards. This file never deletes:
// the nightly job does, through the database's approved functions.

import type { ConfigDiff } from '@pixel-scientists/domain/platform/settings';
import {
  retentionDaysProblem,
  type RetentionPolicy,
  type changeRetentionPolicy,
  type listRetentionPolicies,
} from '@pixel-scientists/domain/platform/retention';

import type { TenantTransaction } from '../../database.ts';
import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import { retentionPolicies } from './policies.ts';

type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type RetentionTables = {
  'app.retention_policy': {
    tenant_id: string;
    id: Generated<string>;
    policy: string;
    days: number;
    created_by: string;
    updated_by: string;
  };
};

const tables = (tx: TenantTransaction) => tx.$extendTables<RetentionTables>();

const view = (
  policyId: string,
  minimumDays: number,
  days: number | undefined,
): RetentionPolicy => ({
  policyId,
  labelKey: policyId,
  days: days ?? minimumDays,
  minimumDays,
  defaultDays: minimumDays,
  changed: days !== undefined,
});

async function readPolicies(tx: TenantTransaction) {
  const rows = await tables(tx)
    .selectFrom('app.retention_policy')
    .select(['policy', 'days'])
    .execute();
  const set = new Map(rows.map((row) => [row.policy, row.days]));
  return [...retentionPolicies].map(([id, minimum]) => view(id, minimum, set.get(id)));
}

export const listRetentionPoliciesHandler: Handler<typeof listRetentionPolicies> = async ({
  tx,
}) => ({ policies: await readPolicies(tx) });

export const changeRetentionPolicyHandler: Handler<typeof changeRetentionPolicy> = async ({
  tx,
  context,
  input,
}) => {
  const { policyId } = input.query;
  const { days } = input.body;
  const minimum = retentionPolicies.get(policyId);
  if (minimum === undefined) throw new ApiError(404, undefined, { reason: 'not_found' });
  if (days < minimum) {
    throw new ApiError(400, 'Check the retention period and try again.', {
      errors: [retentionDaysProblem(minimum)],
      reason: 'refused',
    });
  }

  const db = tables(tx);
  const current = await db
    .selectFrom('app.retention_policy')
    .select('days')
    .where('policy', '=', policyId)
    .forUpdate()
    .executeTakeFirst();
  const before = current?.days ?? minimum;
  if (before === days) return view(policyId, minimum, current?.days);

  const by = context.membership.id;
  const saved = await db
    .insertInto('app.retention_policy')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      policy: policyId,
      days,
      created_by: by,
      updated_by: by,
    }))
    .onConflict((conflict) =>
      conflict.columns(['tenant_id', 'policy']).doUpdateSet({ days, updated_by: by }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();

  const diff: ConfigDiff<'platform.retention'> = [{ field: 'days', from: before, to: days }];
  await context.config.record('platform.retention', saved.id, diff);
  await context.audit.record({
    action: 'platform.retention_policy.changed',
    entityId: saved.id,
    changes: {
      'app.retention_policy.policy': { after: policyId },
      'app.retention_policy.days': { before, after: days },
    },
  });
  return view(policyId, minimum, days);
};
