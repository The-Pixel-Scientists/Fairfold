// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.approval_decision (migrations 0095 and 0096, ADR 0038): isolation,
// INSERT and SELECT only, and separation of duties in the database. The
// requester never decides, a member decides once, only the session's member
// past MFA with a recent step-up decides, nothing is decided on a closed or
// rejected request or beyond its count, a rejection closes its request
// before commit, and reaching the count closes nothing by itself. Most cases
// run in a transaction that is rolled back, so the deferred rejection check
// never runs and each layer is tested on its own.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../tenants.ts';
import {
  actAs,
  addDefinition,
  addSessionMember,
  ask,
  asMember,
  attempt,
  committedAs,
  decide,
  type Member,
} from './workflow-fixtures.ts';

let tenant: TestTenant;
let other: TestTenant;
let requester: Member;
let approvers: Member[];
let stale: Member;
let waiting: Member;
let suspended: Member;
let stranger: Member;
/** A step that needs two approvers, and one that needs one. */
let twoStep: string;
let oneStep: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    requester = await addSessionMember(client, tenant);
    approvers = [
      await addSessionMember(client, tenant),
      await addSessionMember(client, tenant),
      await addSessionMember(client, tenant),
    ];
    stale = await addSessionMember(client, tenant, { reauthenticated: '6 minutes' });
    waiting = await addSessionMember(client, tenant, { mfaState: 'verify' });
    suspended = await addSessionMember(client, tenant);
    await client.query("UPDATE app.membership SET status = 'suspended' WHERE id = $1", [
      suspended.id,
    ]);
  });
  [twoStep = ''] = await addDefinition(tenant, requester, [2]);
  [oneStep = ''] = await addDefinition(tenant, requester, [1]);
  await asMigratorIn(other.id, async (client) => {
    stranger = await addSessionMember(client, other);
  });
}, 60_000);

const [first, second, third] = [0, 1, 2];
const approver = (index: number) => approvers[index] as Member;
const decision = `INSERT INTO app.approval_decision (tenant_id, request_id, decided_by, outcome, reason_code)
                  VALUES ($1, $2, $3, $4, $5)`;
const close = `UPDATE app.approval_request SET status = $2, closed_by = $3 WHERE id = $1`;

/** In one rolled-back transaction, ask as the requester for `version`, then run `work`. */
function withRequest(version: string, work: (client: pg.Client, id: string) => Promise<void>) {
  return asMember(tenant.id, requester, async (client) => {
    const id = await ask(client, tenant.id, version, requester);
    await work(client, id);
  });
}

async function approve(client: pg.Client, id: string, member: Member): Promise<string> {
  await actAs(client, member);
  return attempt(client, decision, [tenant.id, id, member.id, 'approve', null], true);
}

async function statusOf(client: pg.Client, id: string): Promise<unknown> {
  const { rows } = await client.query<{ status: string }>(
    'SELECT status FROM app.approval_request WHERE id = $1',
    [id],
  );
  return rows[0]?.status;
}

/** The tokens of members made by the cross-tenant factory, by membership id. */
const members = new Map<string, Member>();

describe('app.approval_decision', { timeout: 60_000 }, () => {
  it("keeps each tenant's decisions from every other tenant", async () => {
    await expectCrossTenantDenial(
      'app.approval_decision',
      async (_client, owner) => {
        // The request is made through app_api, so its parts are committed first.
        const [asker, decider] = await asMigratorIn(
          owner.id,
          async (client) =>
            [await addSessionMember(client, owner), await addSessionMember(client, owner)] as const,
        );
        const [version] = await addDefinition(owner, asker, [2]);
        members.set(decider.id, decider);
        const request = await committedAs(owner.id, asker, (client) =>
          ask(client, owner.id, String(version), asker),
        );
        return {
          tenant_id: owner.id,
          request_id: request,
          decided_by: decider.id,
          outcome: 'approve',
        };
      },
      (owner, row) =>
        committedAs(owner.id, members.get(String(row.decided_by)) as Member, (client) =>
          insertRow(client, 'app.approval_decision', row),
        ),
    );
  });

  it('needs two distinct approvers, and reaching the count closes nothing by itself', async () => {
    await withRequest(twoStep, async (client, id) => {
      expect(await approve(client, id, approver(first))).toBe('ok');
      expect(await statusOf(client, id)).toBe('pending');
      expect(await attempt(client, close, [id, 'approved', approver(first).id])).toBe(
        '23514 approval_request_closing',
      );
      expect(await approve(client, id, approver(second))).toBe('ok');
      expect(await statusOf(client, id)).toBe('pending');
      expect(await approve(client, id, approver(third))).toBe('23514 approval_decision_complete');
      expect(await attempt(client, close, [id, 'approved', approver(third).id])).toBe(
        '23514 approval_request_closing',
      );
      await actAs(client, approver(second));
      expect(await attempt(client, close, [id, 'approved', approver(second).id], true)).toBe('ok');
      const { rows } = await client.query(
        `SELECT d.decided_at = now() AS decided_now,
                d.retain_until = ((now() AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC' AS kept
           FROM app.approval_decision d WHERE d.request_id = $1`,
        [id],
      );
      expect(rows).toEqual([
        { decided_now: true, kept: true },
        { decided_now: true, kept: true },
      ]);
      expect(await approve(client, id, approver(third))).toBe('23514 approval_decision_pending');
    });
  });

  it('refuses the requester, a second decision by one approver, and a decision on a closed request', async () => {
    await withRequest(twoStep, async (client, id) => {
      expect(await approve(client, id, requester)).toBe('23514 approval_decision_requester');
      expect(await approve(client, id, approver(first))).toBe('ok');
      expect(await approve(client, id, approver(first))).toBe('23505 approval_decision_once');
      await actAs(client, requester);
      await client.query(
        "UPDATE app.approval_request SET status = 'withdrawn', closed_by = $2, close_reason = 'changes_needed' WHERE id = $1",
        [id, requester.id],
      );
      expect(await approve(client, id, approver(second))).toBe('23514 approval_decision_pending');
    });
  });

  it('refuses any decider but the member of a live console session past MFA with a recent step-up', async () => {
    await withRequest(twoStep, async (client, id) => {
      await actAs(client, approver(first));
      const as = (member: Member) =>
        attempt(client, decision, [tenant.id, id, member.id, 'approve', null]);
      expect(await as(approver(second))).toBe('42501 approval_decision_actor');
      await client.query("SELECT pg_catalog.set_config('app.membership_id', $1, true)", [
        approver(second).id,
      ]);
      expect(await as(approver(second))).toBe('42501 approval_decision_actor');
      expect(await as(stranger)).toBe('42501 approval_decision_actor');
      await actAs(client, undefined);
      expect(await as(approver(first))).toBe('42501 approval_decision_actor');
      for (const member of [suspended, waiting, stranger]) {
        await actAs(client, member);
        expect(await as(member)).toBe('42501 approval_decision_actor');
      }
      await actAs(client, stale);
      expect(await as(stale)).toBe('42501 approval_decision_step_up');
      const { rows } = await client.query(
        'SELECT count(*)::integer AS n FROM app.approval_decision WHERE request_id = $1',
        [id],
      );
      expect(rows).toEqual([{ n: 0 }]);
    });
  });

  it('accepts the pre-MFA colleague once the same session completes MFA', async () => {
    const id = await committedAs(tenant.id, requester, (client) =>
      ask(client, tenant.id, twoStep, requester),
    );
    const asWaiting = () =>
      asMember(tenant.id, waiting, (client) =>
        attempt(client, decision, [tenant.id, id, waiting.id, 'approve', null]),
      );
    expect(await asWaiting()).toBe('42501 approval_decision_actor');
    await asMigratorIn(tenant.id, (client) =>
      client.query("UPDATE auth.session SET mfa_state = 'complete' WHERE token_hash = $1", [
        waiting.token,
      ]),
    );
    expect(await asWaiting()).toBe('ok');
  });

  it('closes on one rejection, by its decider, and decides nothing after it', async () => {
    await withRequest(twoStep, async (client, id) => {
      await actAs(client, approver(first));
      expect(
        await attempt(client, decision, [tenant.id, id, approver(first).id, 'reject', null]),
      ).toBe('23514 approval_decision_reason');
      expect(
        await attempt(client, decision, [
          tenant.id,
          id,
          approver(first).id,
          'approve',
          'duplicate',
        ]),
      ).toBe('23514 approval_decision_reason');
      await decide(client, tenant.id, id, approver(first), 'reject');
      expect(await approve(client, id, approver(second))).toBe('23514 approval_decision_rejected');
      expect(await attempt(client, close, [id, 'rejected', approver(second).id])).toBe(
        '23514 approval_request_closing',
      );
      await actAs(client, approver(first));
      expect(await attempt(client, close, [id, 'rejected', approver(first).id])).toBe('ok');
    });
  });

  it('refuses to approve a request with a rejection, even at the count', async () => {
    await withRequest(twoStep, async (client, id) => {
      expect(await approve(client, id, approver(first))).toBe('ok');
      expect(await approve(client, id, approver(second))).toBe('ok');
      await actAs(client, approver(third));
      await decide(client, tenant.id, id, approver(third), 'reject');
      await actAs(client, approver(second));
      expect(await attempt(client, close, [id, 'approved', approver(second).id])).toBe(
        '23514 approval_request_closing',
      );
    });
  });

  it('refuses at commit a rejection that leaves its request pending', async () => {
    const id = await committedAs(tenant.id, requester, (client) =>
      ask(client, tenant.id, twoStep, requester),
    );
    await expect(
      committedAs(tenant.id, approver(first), (client) =>
        decide(client, tenant.id, id, approver(first), 'reject'),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'approval_decision_rejection_closes' });
    await committedAs(tenant.id, approver(first), async (client) => {
      await decide(client, tenant.id, id, approver(first), 'reject');
      await client.query(close, [id, 'rejected', approver(first).id]);
    });
    const counted = await asRoleIn('app_api', tenant.id, (client) =>
      client.query(
        'SELECT count(*)::integer AS n FROM app.approval_decision WHERE request_id = $1',
        [id],
      ),
    );
    expect(counted.rows).toEqual([{ n: 1 }]);
  });

  it('takes two approvers of a one-approver step one at a time', async () => {
    const id = await committedAs(tenant.id, requester, (client) =>
      ask(client, tenant.id, oneStep, requester),
    );
    await withClient('app_api', async (late) => {
      await late.query('BEGIN');
      await late.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      await actAs(late, approver(second));
      const { rows } = await late.query<{ pid: number }>(
        'SELECT pg_catalog.pg_backend_pid() AS pid',
      );
      let blocked: Promise<string> | undefined;
      await committedAs(tenant.id, approver(first), async (early) => {
        await decide(early, tenant.id, id, approver(first));
        blocked = attempt(late, decision, [tenant.id, id, approver(second).id, 'approve', null]);
        for (let tries = 0; tries < 100; tries += 1) {
          const waiting = await early.query(
            "SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
            [rows[0]?.pid],
          );
          if (waiting.rowCount === 1) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await early.query(close, [id, 'approved', approver(first).id]);
      });
      expect(await blocked).toBe('23514 approval_decision_pending');
      await late.query('ROLLBACK');
    });
  });

  it('lets no app role change or remove a decision, and app_worker not add one', async () => {
    const id = await committedAs(tenant.id, requester, (client) =>
      ask(client, tenant.id, twoStep, requester),
    );
    await committedAs(tenant.id, approver(first), (client) =>
      decide(client, tenant.id, id, approver(first)),
    );
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        expect(
          await attempt(client, "UPDATE app.approval_decision SET outcome = 'reject'"),
          role,
        ).toBe('42501');
        expect(await attempt(client, 'DELETE FROM app.approval_decision'), role).toBe('42501');
      });
    }
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(
        await attempt(client, decision, [tenant.id, id, approver(second).id, 'approve', null]),
      ).toBe('42501');
    });
  });
});
