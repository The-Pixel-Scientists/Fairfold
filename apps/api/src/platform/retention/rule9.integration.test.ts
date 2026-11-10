// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Humans decide (rule 9): a full retention sweep, with applications,
// decisions, stage transitions and reviews all older than every retention
// period, changes no decision outcome, amount, release time, application
// status or stage, and deletes no row. Another tenant's older rows and
// settings are untouched too.

import { withTenant } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import { accepted, startDecisionsApi, type DecisionsApi } from '../../../test/decisions-api.ts';
import { answer } from '../../../test/programme-api.ts';
import { sweepTenant } from './sweep.ts';

vi.setConfig({ testTimeout: 60_000 });

let t: DecisionsApi;

beforeAll(async () => {
  t = await startDecisionsApi('41076');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** The tables a retention rule could reach, with the column that dates each row. */
const AGED = {
  'grants.application': 'created_at',
  'grants.decision': 'created_at',
  'grants.stage_transition': 'moved_at',
  'grants.assignment': 'created_at',
  'grants.score': 'created_at',
};

/** Every row of the tables a retention rule could reach, as the migrator reads them. */
async function snapshot(): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of Object.keys(AGED)) {
    result[table] = await t.rows(`SELECT * FROM ${table} ORDER BY id`);
  }
  return result;
}

describe('the sweep', () => {
  it('changes no decision, status or stage and deletes no row, whatever the age', async () => {
    const round = await t.reviewRound();
    const submission = await t.submission(round);
    await t.recorded(submission, accepted(15_000));
    await answer(t.release(round.open.round.id));
    for (const [table, column] of Object.entries(AGED)) {
      await t.rows(`UPDATE ${table} SET ${column} = now() - interval '30 years'`);
    }

    const before = await snapshot();
    expect(before['grants.decision']).toHaveLength(1);
    expect(before['grants.application']?.length).toBeGreaterThan(0);

    for (const tenant of [t.tenantA, t.tenantB]) {
      await withTenant(t.worker, trustedTenantId(tenant.id), (trx) => sweepTenant(trx, 20));
    }

    expect(await snapshot()).toEqual(before);
  });
});
