// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure.screening_run, assure.screening_match and assure.match_decision
// (migration 0055): denied across tenants; a run moves on from queued once,
// with its list version, and keeps its party, trigger and requester; matches
// are raised by app_worker alone and change only to take a linked officer's
// person; decisions are append-only, a named member's, with a reason that
// fits the outcome, and never written by app_worker (rule 9).

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { expectEveryRoleRefused, insertOutcome } from '../notes/fixtures.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addList,
  addMatch,
  addRun,
  addSnapshot,
  matchRow,
  officerRow,
  runRow,
} from './fixtures.ts';

let tenant: TestTenant;
let member: string;
let party: string;
let run: string;
let list: string;
let secondList: string;
let match: string;
let strangers: { member: string; party: string; run: string; match: string };

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    list = await addList(client);
    secondList = await addList(client);
  });
  await asMigratorIn(tenant.id, async (client) => {
    member = await addMember(client, tenant, ['programme_manager']);
    ({ party, run, match } = await addMatch(client, tenant, list));
  });
  strangers = await asMigratorIn(stranger.id, async (client) => ({
    member: await addMember(client, stranger),
    ...(await addMatch(client, stranger, list)),
  }));
}, 60_000);

const decisionRow = (change: Record<string, unknown> = {}) => ({
  tenant_id: tenant.id,
  match_id: match,
  outcome: 'not_a_match',
  reason_code: 'different_date_of_birth',
  decided_by: member,
  ...change,
});

/** Complete a queued run as app_worker, inside `work`'s transaction. */
const COMPLETE = `UPDATE assure.screening_run
   SET status = 'completed', list_id = $2, list_last_checked_at = now(), threshold = 0.5,
       names_screened = 3, matches_raised = 1
 WHERE id = $1`;

describe('assure.screening_run', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.screening_run', async (client, row) =>
      runRow(row, await addOrganisation(client, row)),
    ));

  it("refuses another tenant's party or requester", async () => {
    expect(
      await insertOutcome(
        'app_worker',
        tenant,
        'assure.screening_run',
        runRow(tenant, strangers.party),
      ),
    ).toBe('23503');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.screening_run',
        runRow(tenant, party, { trigger: 'on_demand', requested_by: strangers.member }),
      ),
    ).toBe('23503');
  });

  it('names its requester exactly when started on demand', async () => {
    const onDemand = { trigger: 'on_demand', requested_by: member };
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.screening_run',
        runRow(tenant, party, onDemand),
      ),
    ).toBe('ok');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.screening_run',
        runRow(tenant, party, { trigger: 'on_demand' }),
      ),
    ).toBe('23514');
    expect(
      await insertOutcome(
        'app_worker',
        tenant,
        'assure.screening_run',
        runRow(tenant, party, { requested_by: member }),
      ),
    ).toBe('42501');
  });

  it('moves on from queued once, with its list, and keeps what started it', async () => {
    const queued = await asMigratorIn(
      tenant.id,
      async (client) => (await addRun(client, tenant)).run,
    );
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(
        await outcome(
          client,
          "UPDATE assure.screening_run SET status = 'completed' WHERE id = $1",
          [queued],
        ),
      ).toBe('23514');
      expect(
        await outcome(client, 'UPDATE assure.screening_run SET names_screened = 2 WHERE id = $1', [
          queued,
        ]),
      ).toBe('55000');
      await client.query(COMPLETE, [queued, list]);
      const { rows } = await client.query<{ completed_at: Date | null }>(
        'SELECT completed_at FROM assure.screening_run WHERE id = $1',
        [queued],
      );
      expect(rows[0]?.completed_at).toBeInstanceOf(Date);
      for (const statement of [
        "UPDATE assure.screening_run SET status = 'failed', error_code = 'list_unreadable', list_id = NULL, list_last_checked_at = NULL, threshold = NULL WHERE id = $1",
        'UPDATE assure.screening_run SET list_id = $2 WHERE id = $1',
        'UPDATE assure.screening_run SET matches_raised = 0 WHERE id = $1',
      ]) {
        const values = statement.includes('$2') ? [queued, secondList] : [queued];
        expect(await outcome(client, statement, values), statement).toBe('55000');
      }
    });
    await asMigratorIn(tenant.id, async (client) => {
      for (const statement of [
        'UPDATE assure.screening_run SET party_id = $2 WHERE id = $1',
        "UPDATE assure.screening_run SET trigger = 'list_update' WHERE id = $1",
      ]) {
        const values = statement.includes('$2') ? [queued, party] : [queued];
        expect(await outcome(client, statement, values), statement).toBe('23514');
      }
    });
  });

  it('fails with a code only, and holds no list then', async () => {
    const queued = await asMigratorIn(
      tenant.id,
      async (client) => (await addRun(client, tenant)).run,
    );
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const FAIL =
        "UPDATE assure.screening_run SET status = 'failed', error_code = $2 WHERE id = $1";
      expect(await outcome(client, FAIL, [queued, 'Connection refused: 10.0.0.1'])).toBe('23514');
      expect(
        await outcome(client, "UPDATE assure.screening_run SET status = 'failed' WHERE id = $1", [
          queued,
        ]),
      ).toBe('23514');
      expect(await outcome(client, FAIL, [queued, 'list_unreadable'])).toBe('ok');
    });
  });

  it('caps the threshold a run may apply at the platform default', async () => {
    const queued = await asMigratorIn(
      tenant.id,
      async (client) => (await addRun(client, tenant)).run,
    );
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await outcome(client, COMPLETE.replace('0.5', '0.6'), [queued, list])).toBe('23514');
    });
  });

  it('is never deleted by an app role', async () => {
    await expectEveryRoleRefused(tenant, 'DELETE FROM assure.screening_run WHERE id = $1', [run]);
  });
});

describe('assure.screening_match', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.screening_match', async (client, row) => {
      const added = await addRun(client, row);
      return matchRow(row, added.run, added.party, list);
    }));

  it('is raised by app_worker only, on a run of its own tenant and party', async () => {
    const row = matchRow(tenant, run, party, list);
    expect(await insertOutcome('app_worker', tenant, 'assure.screening_match', row)).toBe('ok');
    expect(await insertOutcome('app_api', tenant, 'assure.screening_match', row)).toBe('42501');
    expect(
      await insertOutcome('app_worker', tenant, 'assure.screening_match', {
        ...row,
        run_id: strangers.run,
      }),
    ).toBe('23503');
    const other = await asMigratorIn(tenant.id, (client) => addOrganisation(client, tenant));
    expect(
      await insertOutcome('app_worker', tenant, 'assure.screening_match', {
        ...row,
        party_id: other,
        subject_party_id: other,
      }),
    ).toBe('23503');
  });

  it.each([
    ['a similarity above 1', { similarity: 1.2 }],
    ['a registered name about another party', { subject_party_id: null }],
    ['an unknown name source', { name_source: 'alias' }],
  ])('refuses %s', async (_name, change) => {
    expect(
      await insertOutcome(
        'app_worker',
        tenant,
        'assure.screening_match',
        matchRow(tenant, run, party, list, change),
      ),
    ).toBe('23514');
  });

  it("takes an officer's person once the officer is linked, and changes no other way", async () => {
    const { officer, person } = await asMigratorIn(tenant.id, async (client) => {
      const { snapshot } = await addSnapshot(client, tenant);
      return {
        officer: await insertRow(client, 'assure.lookup_officer', officerRow(tenant, snapshot)),
        person: await addPerson(client, tenant),
      };
    });
    const officerMatch = await asMigratorIn(tenant.id, (client) =>
      insertRow(
        client,
        'assure.screening_match',
        matchRow(tenant, run, party, list, {
          name_source: 'officer',
          officer_id: officer,
          subject_party_id: null,
          entry_kind: 'individual',
        }),
      ),
    );
    const SUBJECT = 'UPDATE assure.screening_match SET subject_party_id = $2 WHERE id = $1';
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, SUBJECT, [officerMatch, person])).toBe('23514');
      await client.query(
        'UPDATE assure.lookup_officer SET person_id = $2, linked_by = $3 WHERE id = $1',
        [officer, person, member],
      );
      expect(await outcome(client, SUBJECT, [officerMatch, person])).toBe('ok');
      expect(await outcome(client, SUBJECT, [match, null])).toBe('55000');
      expect(
        await outcome(client, 'UPDATE assure.screening_match SET similarity = 1 WHERE id = $1', [
          match,
        ]),
      ).toBe('42501');
    });
  });

  it('is never deleted by an app role', async () => {
    await expectEveryRoleRefused(tenant, 'DELETE FROM assure.screening_match WHERE id = $1', [
      match,
    ]);
  });
});

describe('assure.match_decision', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.match_decision', async (client, row) => ({
      tenant_id: row.id,
      match_id: (await addMatch(client, row, list)).match,
      // Not a match, so the outcome check reads no match: a row for another
      // tenant meets row-level security, not that check.
      outcome: 'not_a_match',
      reason_code: 'different_name',
      decided_by: await addMember(client, row),
    })));

  it('is recorded by app_api for a named member, and never by app_worker', async () => {
    expect(await insertOutcome('app_api', tenant, 'assure.match_decision', decisionRow())).toBe(
      'ok',
    );
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.match_decision',
        decisionRow({ decided_by: null }),
      ),
    ).toBe('23502');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.match_decision',
        decisionRow({ decided_by: strangers.member }),
      ),
    ).toBe('23503');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.match_decision',
        decisionRow({ match_id: strangers.match }),
      ),
    ).toBe('23503');
    expect(await insertOutcome('app_worker', tenant, 'assure.match_decision', decisionRow())).toBe(
      '42501',
    );
  });

  it.each([
    ['not_a_match', 'identity_confirmed'],
    ['confirmed', 'different_name'],
    ['needs_information', 'different_country'],
    ['rejected', 'identity_confirmed'],
  ])('refuses outcome %s with reason %s', async (decided, reason) => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.match_decision',
        decisionRow({ outcome: decided, reason_code: reason }),
      ),
    ).toBe('23514');
  });

  it('decides an unlinked officer match only as not a match', async () => {
    const unlinked = await asMigratorIn(tenant.id, async (client) => {
      const { snapshot } = await addSnapshot(client, tenant);
      const officer = await insertRow(
        client,
        'assure.lookup_officer',
        officerRow(tenant, snapshot),
      );
      return insertRow(
        client,
        'assure.screening_match',
        matchRow(tenant, run, party, list, {
          name_source: 'officer',
          officer_id: officer,
          subject_party_id: null,
        }),
      );
    });
    const confirm = decisionRow({
      match_id: unlinked,
      outcome: 'confirmed',
      reason_code: 'identity_confirmed',
    });
    expect(await insertOutcome('app_api', tenant, 'assure.match_decision', confirm)).toBe('55000');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.match_decision',
        decisionRow({ match_id: unlinked }),
      ),
    ).toBe('ok');
  });

  it('sets its own decision time, whatever the caller sends', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'assure.match_decision', decisionRow({ decided_at: new Date(0) })),
    );
    await asMigratorIn(tenant.id, async (client) => {
      const { rows } = await client.query<{ decided_at: Date }>(
        'SELECT decided_at FROM assure.match_decision WHERE id = $1',
        [id],
      );
      expect(rows[0]?.decided_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  it('is append-only for every app role', async () => {
    const decision = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'assure.match_decision', decisionRow()),
    );
    for (const statement of [
      "UPDATE assure.match_decision SET outcome = 'confirmed' WHERE id = $1",
      'DELETE FROM assure.match_decision WHERE id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [decision]);
    }
  });

  it('is written by no function or trigger: nothing in the schema inserts a decision', async () => {
    await asMigratorIn(tenant.id, async (client) => {
      const { rows } = await client.query<{ name: string }>(
        `SELECT p.proname AS name FROM pg_catalog.pg_proc p
          WHERE p.pronamespace = 'assure'::regnamespace
            AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%match_decision%'
            AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%insert%'`,
      );
      expect(rows).toEqual([]);
    });
  });
});
