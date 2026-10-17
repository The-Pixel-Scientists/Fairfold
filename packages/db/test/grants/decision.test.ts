// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.decision (migration 0013): isolation, one decision per
// submitted application, an amount exactly for an award and within the bound, the
// recording and release times the database sets, a released decision
// that nothing changes or removes (architecture rule 8). A withdrawn
// application's decision is never changed or released, and an application
// whose decision is released is never withdrawn.

import type pg from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addApplication } from './application-fixtures.ts';
import { addSubmission, decisionRow, release, type Submission } from './decision-fixtures.ts';

const NO_AMOUNT = { amount_minor: null, currency: null };
const WITHDRAW = "UPDATE grants.application SET status = 'withdrawn' WHERE id = $1";

/** A tenant's submission, and another tenant's. */
let tenant: TestTenant;
let submission: Submission;
let strangers: Submission;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  submission = await asMigratorIn(tenant.id, (client) => addSubmission(client, tenant));
  strangers = await asMigratorIn(other.id, (client) => addSubmission(client, other));
}, 60_000);

describe('grants.decision', { timeout: 30_000 }, () => {
  it("keeps each tenant's decisions from every other tenant", async () => {
    await expectCrossTenantDenial('grants.decision', async (client, owner) =>
      decisionRow(owner, await addSubmission(client, owner)),
    );
  });

  it.each([
    ['records an award with its amount', {}, 'ok'],
    ['records an award of the largest amount', { amount_minor: 100_000_000_000 }, 'ok'],
    ['records a place on the waiting list', { outcome: 'waitlisted', ...NO_AMOUNT }, 'ok'],
    ['records a decline', { outcome: 'declined', ...NO_AMOUNT }, 'ok'],
    ['refuses an award without an amount', NO_AMOUNT, '23514'],
    ['refuses an amount without a currency', { currency: null }, '23514'],
    ['refuses a decline with an amount', { outcome: 'declined' }, '23514'],
    ['refuses a waiting list place with an amount', { outcome: 'waitlisted' }, '23514'],
    ['refuses an amount of nothing', { amount_minor: 0 }, '23514'],
    ['refuses an amount over the bound', { amount_minor: 100_000_000_001 }, '23514'],
    ['refuses another currency', { currency: 'EUR' }, '23514'],
    ['refuses an unknown outcome', { outcome: 'deferred', ...NO_AMOUNT }, '23514'],
    ["refuses another tenant's application", { application_id: '<strangers app>' }, '23503'],
    ['refuses a recorder from another tenant', { recorded_by: '<stranger>' }, '23503'],
    ['refuses a release from the caller', { released_by: '<manager>' }, '42501'],
    ['refuses a recording time from the caller', { recorded_at: '2000-01-01' }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<strangers app>': strangers.application,
      '<stranger>': strangers.manager,
      '<manager>': submission.manager,
    };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const row = decisionRow(tenant, submission, values);
      const statement = insertStatement(client, 'grants.decision', row);
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it.each([
    ['a draft', (client: pg.ClientBase) => addApplication(client, tenant).then(({ id }) => id)],
    [
      'a withdrawn application',
      async (client: pg.ClientBase) => {
        const { application } = await addSubmission(client, tenant);
        await client.query("UPDATE grants.application SET status = 'withdrawn' WHERE id = $1", [
          application,
        ]);
        return application;
      },
    ],
  ])('refuses a decision on %s', async (_, add) => {
    const application = await asMigratorIn(tenant.id, add);
    await asRoleIn('app_api', tenant.id, async (client) => {
      const row = decisionRow(tenant, submission, { application_id: application });
      const statement = insertStatement(client, 'grants.decision', row);
      expect(await outcome(client, statement.text, statement.values)).toBe('55000');
    });
  });

  it('records one decision per application', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      const again = insertStatement(
        client,
        'grants.decision',
        decisionRow(tenant, submission, { outcome: 'declined', ...NO_AMOUNT }),
      );
      expect(await outcome(client, again.text, again.values)).toBe('23505');
    });
  });

  it('changes an unreleased decision, and fixes what it is for', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      const change =
        "UPDATE grants.decision SET outcome = 'declined', amount_minor = NULL, currency = NULL WHERE id = $1";
      expect(await outcome(client, change, [id])).toBe('ok');
      for (const set of [
        'application_id = application_id',
        'recorded_at = now()',
        'released_at = now()',
        'tenant_id = tenant_id',
        'created_at = created_at',
      ]) {
        const update = `UPDATE grants.decision SET ${set} WHERE id = $1`;
        expect(await outcome(client, update, [id]), set).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM grants.decision WHERE id = $1', [id])).toBe(
        '42501',
      );
    });
  });

  it('sets the recording time when the outcome or amount changes, whatever the caller sends', async () => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'grants.decision',
        decisionRow(tenant, submission, { recorded_at: '2000-01-01' }),
      );
      const recordedNow = async () =>
        (
          await client.query<{ now: boolean }>(
            'SELECT recorded_at = now() AS now FROM grants.decision WHERE id = $1',
            [id],
          )
        ).rows[0]?.now;
      await client.query('UPDATE grants.decision SET updated_by = updated_by WHERE id = $1', [id]);
      expect(await recordedNow()).toBe(false);
      await client.query(
        "UPDATE grants.decision SET amount_minor = 1600000, recorded_at = '2000-01-01' WHERE id = $1",
        [id],
      );
      expect(await recordedNow()).toBe(true);
    });
  });

  it('releases at the time of the transaction, as recorded, and only with a releaser', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      const changed = `UPDATE grants.decision
          SET outcome = 'declined', amount_minor = NULL, currency = NULL, released_by = $2
        WHERE id = $1`;
      expect(await outcome(client, changed, [id, submission.manager])).toBe('55000');
      await release(client, id, submission.manager);
      const { rows } = await client.query(
        `SELECT outcome, amount_minor, released_by, released_at = now() AS now
           FROM grants.decision WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([
        {
          outcome: 'accepted',
          amount_minor: '1500000',
          released_by: submission.manager,
          now: true,
        },
      ]);
    });
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      const update = 'UPDATE grants.decision SET released_at = now() WHERE id = $1';
      expect(await outcome(client, update, [id])).toBe('23514');
    });
  });

  it.each(['app_api', 'migrator'] as const)(
    'never lets %s change a released decision',
    async (role) => {
      await asRoleIn(role, tenant.id, async (client) => {
        const id = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
        await release(client, id, submission.manager);
        for (const set of [
          "outcome = 'declined', amount_minor = NULL, currency = NULL",
          'amount_minor = 1',
          'released_by = NULL',
          'recorded_by = recorded_by',
          'updated_by = updated_by',
        ]) {
          const { rowCount } = await client.query(
            `UPDATE grants.decision SET ${set} WHERE id = $1`,
            [id],
          );
          expect(rowCount, set).toBe(0);
        }
        const { rows } = await client.query(
          'SELECT outcome, released_by FROM grants.decision WHERE id = $1',
          [id],
        );
        expect(rows).toEqual([{ outcome: 'accepted', released_by: submission.manager }]);
      });
    },
  );

  it.each([
    ['change', "outcome = 'declined', amount_minor = NULL, currency = NULL"],
    ['release', 'released_by = recorded_by'],
    ['touch', 'updated_by = updated_by'],
  ])('refuses to %s a decision on a withdrawn application', async (_, set) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      await client.query(WITHDRAW, [submission.application]);
      const update = `UPDATE grants.decision SET ${set} WHERE id = $1`;
      expect(await outcome(client, update, [id])).toBe('55000');
    });
  });

  it('lets an application be withdrawn until its decision is released, and no later', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      expect(await outcome(client, WITHDRAW, [submission.application])).toBe('ok');
    });
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      await release(client, id, submission.manager);
      expect(await outcome(client, WITHDRAW, [submission.application])).toBe('55000');
    });
  });

  it.each([
    ['a release waits for a withdrawal, then is refused', 'withdraw'],
    ['a withdrawal waits for a release, then is refused', 'release'],
  ])('%s', async (_, first) => {
    const own = await createTestTenant();
    const fresh = await asMigratorIn(own.id, (client) => addSubmission(client, own));
    const id = await asMigratorIn(own.id, (client) =>
      insertRow(client, 'grants.decision', decisionRow(own, fresh)),
    );
    const withdraw = (client: pg.ClientBase) => client.query(WITHDRAW, [fresh.application]);
    const releaseIt = (client: pg.ClientBase) => release(client, id, fresh.manager);
    const [before, after] = first === 'withdraw' ? [withdraw, releaseIt] : [releaseIt, withdraw];
    const refused = await withClient('app_api', (one) =>
      withClient('app_api', async (two) => {
        for (const client of [one, two]) {
          await client.query('BEGIN');
          await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [own.id]);
        }
        await before(one);
        const { rows } = await two.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        const waiting = after(two).then(
          () => 'ok',
          (error: unknown) => (error as { code?: string }).code,
        );
        await vi.waitFor(
          async () => {
            const blocked = await one.query<{ pids: number[] }>(
              'SELECT pg_catalog.pg_blocking_pids($1::int) AS pids',
              [rows[0]?.pid],
            );
            expect(blocked.rows[0]?.pids.length).toBeGreaterThan(0);
          },
          { timeout: 10_000 },
        );
        await one.query('COMMIT');
        const code = await waiting;
        await two.query('ROLLBACK');
        return code;
      }),
    );
    expect(refused).toBe('55000');
  });

  it('never lets app_api remove a released decision', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.decision', decisionRow(tenant, submission));
      await release(client, id, submission.manager);
      const remove = 'DELETE FROM grants.decision WHERE id = $1';
      expect(await outcome(client, remove, [id])).toBe('42501');
    });
  });
});
