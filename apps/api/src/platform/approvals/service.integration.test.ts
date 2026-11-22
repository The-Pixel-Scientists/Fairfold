// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The workflow service against the test database, as app_api (ADR 0038): the
// requests and decisions it writes, separation of duties checked by the
// server and again by the database with the server's check bypassed, step-up,
// the tenant boundary, and two members deciding at once. Members have real
// sessions, which the triggers read; the project's db settings supply the
// connections (scripts/dev-env.ts, profile database-tests).

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { asMember, attempt } from '../../../../../packages/db/test/app/workflow-fixtures.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import {
  addActor,
  asActor,
  flow,
  kindOf,
  Links,
  REQUESTER_ROLES,
  serviceFor,
  setRoles,
  storeDefinition,
  type Actor,
} from '../../../test/approvals-support.ts';
import { switchModule } from '../../../test/modules-on.ts';
import { ApiError } from '../../problems.ts';

const links = new Links();
const grantsFlow = flow('grants.sign_off', 'grants.data.export');
const pinnedFlow = flow('grants.pinned', 'grants.data.export');
const crmFlow = flow('crm.sign_off', 'crm.records.export', { approvers: 2, sensitiveRead: true });
const { service, published } = serviceFor([
  kindOf(grantsFlow, links),
  kindOf(pinnedFlow, links),
  kindOf(crmFlow, links),
]);

let tenant: TestTenant;
let other: TestTenant;
let requester: Actor;
let approver: Actor;
let second: Actor;
let third: Actor;
let outsider: Actor;
let versions: string[];
let party: string;

const rows = <T>(target: TestTenant, query: string, values: unknown[] = []): Promise<T[]> =>
  asMigratorIn(target.id, async (client) => (await client.query(query, values)).rows as T[]);

/** The status and reason of a refusal, or the error if it was something else. */
async function refusedAs(work: Promise<unknown>): Promise<{ status: number; reason?: string }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, reason: error.reason };
    throw error;
  }
  throw new Error('The work was not refused.');
}

/** A request for `key`, made by `by`, linked to a subject. */
async function ask(key = 'grants.sign_off', by: Actor = requester): Promise<string> {
  const id = await asActor(service, by, (workflow) =>
    workflow.request({ definitionKey: key, stepId: 'sign_off', subjectPartyId: party }),
  );
  links.link(id, party);
  return id;
}

const decisionCount = async (id: string): Promise<number> =>
  Number(
    (
      await rows<{ n: string }>(
        tenant,
        'SELECT count(*) AS n FROM app.approval_decision WHERE request_id = $1',
        [id],
      )
    )[0]?.n,
  );

beforeAll(async () => {
  [tenant, other] = await Promise.all([createTestTenant(), createTestTenant()]);
  [requester, approver, second, third, outsider] = await Promise.all([
    addActor(tenant, REQUESTER_ROLES),
    addActor(tenant),
    addActor(tenant),
    addActor(tenant),
    addActor(other),
  ]);
  for (const target of [tenant, other]) {
    await switchModule(target, 'grants');
    await switchModule(target, 'crm');
  }
  party = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
  await storeDefinition(tenant, approver, grantsFlow);
  versions = await storeDefinition(tenant, approver, pinnedFlow, [2]);
  await storeDefinition(tenant, approver, crmFlow);
}, 60_000);

describe('request', () => {
  it('pins the latest stored version and takes the requester from the session', async () => {
    const id = await ask('grants.pinned');

    const [row] = await rows<Record<string, unknown>>(
      tenant,
      `SELECT definition_version_id, definition_key, required_approvals, requested_by, status
         FROM app.approval_request WHERE id = $1`,
      [id],
    );
    expect(row).toEqual({
      definition_version_id: versions[1],
      definition_key: 'grants.pinned',
      required_approvals: 2,
      requested_by: requester.id,
      status: 'pending',
    });
    const [event] = await rows<{ actor_id: string; subject_party_id: string }>(
      tenant,
      `SELECT actor_id, subject_party_id FROM app.audit_event
        WHERE action = 'platform.approval.requested' AND entity_id = $1`,
      [id],
    );
    expect(event).toEqual({ actor_id: requester.id, subject_party_id: party });
  });

  it('commits or rolls back with the module change that asked for it', async () => {
    const before = await rows(tenant, 'SELECT id FROM app.approval_request');

    await expect(
      asActor(service, requester, async (workflow) => {
        await workflow.request({ definitionKey: 'grants.sign_off', stepId: 'sign_off' });
        throw new Error('The module failed after asking.');
      }),
    ).rejects.toThrow('The module failed after asking.');

    expect(await rows(tenant, 'SELECT id FROM app.approval_request')).toHaveLength(before.length);
  });

  it('treats a workflow or step the module does not ship as the module bug, not the caller', async () => {
    await expect(
      asActor(service, requester, (workflow) =>
        workflow.request({ definitionKey: 'grants.unknown', stepId: 'sign_off' }),
      ),
    ).rejects.not.toBeInstanceOf(ApiError);
    await expect(
      asActor(service, requester, (workflow) =>
        workflow.request({ definitionKey: 'grants.sign_off', stepId: 'no_such_step' }),
      ),
    ).rejects.toThrow('does not ship');
  });

  it('answers 404 where the tenant has switched the module off', async () => {
    const off = await createTestTenant();
    const author = await addActor(off);
    await switchModule(off, 'grants', false);

    expect(
      await refusedAs(
        asActor(service, author, (workflow) =>
          workflow.request({ definitionKey: 'grants.sign_off', stepId: 'sign_off' }),
        ),
      ),
    ).toMatchObject({ status: 404 });
  });
});

describe('decide', () => {
  it('approves a one-approver step, closes it, audits it and publishes it', async () => {
    const id = await ask();
    published.length = 0;

    const result = await asActor(service, approver, (workflow) =>
      workflow.decide(id, { outcome: 'approve' }),
    );

    expect(result).toMatchObject({
      status: 'approved',
      approvals: 1,
      requiredApprovals: 1,
      canDecide: false,
      canWithdraw: false,
      decisions: [{ decidedBy: approver.id, outcome: 'approve', reasonCode: null }],
    });
    expect(published).toMatchObject([{ requestId: id, outcome: 'approved', by: approver.id }]);
    const [event] = await rows<{ actor_id: string; subject_party_id: string }>(
      tenant,
      `SELECT actor_id, subject_party_id FROM app.audit_event
        WHERE action = 'platform.approval.approved' AND entity_id = $1`,
      [id],
    );
    expect(event).toEqual({ actor_id: approver.id, subject_party_id: party });
  });

  it('needs every distinct approver, and closes only with the last', async () => {
    const id = await ask('crm.sign_off');
    published.length = 0;

    const first = await asActor(service, approver, (workflow) =>
      workflow.decide(id, { outcome: 'approve' }),
    );
    expect(first).toMatchObject({ status: 'pending', approvals: 1, requiredApprovals: 2 });
    expect(published).toHaveLength(0);

    const last = await asActor(service, second, (workflow) =>
      workflow.decide(id, { outcome: 'approve' }),
    );
    expect(last).toMatchObject({ status: 'approved', approvals: 2 });
    expect(published).toHaveLength(1);
  });

  it('closes a request as rejected on one rejection, with its reason code', async () => {
    const id = await ask('crm.sign_off');
    published.length = 0;

    const result = await asActor(service, approver, (workflow) =>
      workflow.decide(id, { outcome: 'reject', reasonCode: 'missing_evidence' }),
    );

    expect(result).toMatchObject({
      status: 'rejected',
      decisions: [{ outcome: 'reject', reasonCode: 'missing_evidence' }],
    });
    expect(published).toMatchObject([{ requestId: id, outcome: 'rejected' }]);
  });

  it('refuses the requester, a second decision by one member and a member without the step permission', async () => {
    const id = await ask('crm.sign_off');
    await asActor(service, approver, (w) => w.decide(id, { outcome: 'approve' }));

    expect(
      await refusedAs(asActor(service, requester, (w) => w.decide(id, { outcome: 'approve' }))),
    ).toEqual({ status: 403, reason: 'requester_cannot_approve' });
    expect(
      await refusedAs(asActor(service, approver, (w) => w.decide(id, { outcome: 'approve' }))),
    ).toEqual({ status: 409, reason: 'already_decided' });
    // The programme manager role may decide, but the step needs the export permission too.
    const madeByApprover = await ask('crm.sign_off', approver);
    expect(
      await refusedAs(
        asActor(service, requester, (w) => w.decide(madeByApprover, { outcome: 'approve' })),
      ),
    ).toEqual({ status: 403, reason: 'not_permitted' });
    expect(await decisionCount(id)).toBe(1);
    expect(await decisionCount(madeByApprover)).toBe(0);
  });

  it('checks the approver permissions as they are when deciding, not when the request was made', async () => {
    const id = await ask();
    await setRoles(third, REQUESTER_ROLES);

    expect(
      await refusedAs(asActor(service, third, (w) => w.decide(id, { outcome: 'approve' }))),
    ).toEqual({ status: 403, reason: 'not_permitted' });
    expect(await decisionCount(id)).toBe(0);
    await setRoles(third, ['programme_manager', 'tenant_admin']);
  });

  it('refuses a decision without a step-up in the last 5 minutes, and writes nothing', async () => {
    const id = await ask();

    for (const recentAuthAt of [
      null,
      new Date(Date.now() - 6 * 60_000),
      new Date(Date.now() + 60_000),
    ]) {
      expect(
        await refusedAs(
          asActor(service, approver, (w) => w.decide(id, { outcome: 'approve' }), { recentAuthAt }),
        ),
      ).toEqual({ status: 403, reason: 'step_up' });
    }
    expect(await decisionCount(id)).toBe(0);
  });

  it('answers 404 for a request the member does not reach through its subject', async () => {
    const id = await ask();
    links.hide(approver, id);

    expect(
      await refusedAs(asActor(service, approver, (w) => w.decide(id, { outcome: 'approve' }))),
    ).toMatchObject({ status: 404 });
    expect(await refusedAs(asActor(service, approver, (w) => w.state(id)))).toMatchObject({
      status: 404,
    });
    expect(await decisionCount(id)).toBe(0);
  });

  it('refuses a decision on a settled step or a withdrawn request', async () => {
    const settled = await ask();
    await asActor(service, approver, (w) => w.decide(settled, { outcome: 'approve' }));
    const withdrawn = await ask();
    await asActor(service, requester, (w) => w.withdraw(withdrawn, 'made_in_error'));

    expect(
      await refusedAs(asActor(service, second, (w) => w.decide(settled, { outcome: 'approve' }))),
    ).toEqual({ status: 409, reason: 'step_complete' });
    expect(
      await refusedAs(asActor(service, second, (w) => w.decide(withdrawn, { outcome: 'approve' }))),
    ).toEqual({ status: 409, reason: 'request_closed' });
  });

  it('takes exactly one of two members deciding a one-approver step at once', async () => {
    const id = await ask();

    const results = await Promise.allSettled([
      asActor(service, approver, (w) => w.decide(id, { outcome: 'approve' })),
      asActor(service, second, (w) => w.decide(id, { outcome: 'approve' })),
    ]);

    const failed = results.filter((result) => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
      reason: 'step_complete',
    });
    expect(await decisionCount(id)).toBe(1);
  });

  it('does not move the subject: nothing but the request changes when the count is reached', async () => {
    const id = await ask();
    const before = await rows(tenant, 'SELECT * FROM app.approval_request WHERE id <> $1', [id]);

    await asActor(service, approver, (w) => w.decide(id, { outcome: 'approve' }));

    expect(await rows(tenant, 'SELECT * FROM app.approval_request WHERE id <> $1', [id])).toEqual(
      before,
    );
  });
});

describe('the database refuses again, with the server check bypassed', () => {
  const insert = `INSERT INTO app.approval_decision (tenant_id, request_id, decided_by, outcome)
                  VALUES ($1, $2, $3, 'approve')`;

  it('refuses a decision by the requester, a second by one approver and one on a closed request', async () => {
    const id = await ask('crm.sign_off');
    await asActor(service, approver, (w) => w.decide(id, { outcome: 'approve' }));
    const closed = await ask();
    await asActor(service, approver, (w) => w.decide(closed, { outcome: 'approve' }));

    const results = await Promise.all([
      asMember(tenant.id, requester, (client) =>
        attempt(client, insert, [tenant.id, id, requester.id]),
      ),
      asMember(tenant.id, approver, (client) =>
        attempt(client, insert, [tenant.id, id, approver.id]),
      ),
      asMember(tenant.id, second, (client) =>
        attempt(client, insert, [tenant.id, closed, second.id]),
      ),
    ]);

    expect(results).toEqual([
      '23514 approval_decision_requester',
      '23505 approval_decision_once',
      '23514 approval_decision_pending',
    ]);
  });
});

describe('withdraw', () => {
  it('lets only the requester withdraw, once, with a reason code', async () => {
    const id = await ask();

    expect(
      await refusedAs(asActor(service, approver, (w) => w.withdraw(id, 'no_longer_needed'))),
    ).toEqual({ status: 403, reason: 'not_requester' });
    const result = await asActor(service, requester, (w) => w.withdraw(id, 'changes_needed'));
    expect(result).toMatchObject({ status: 'withdrawn', closeReason: 'changes_needed' });
    expect(
      await refusedAs(asActor(service, requester, (w) => w.withdraw(id, 'made_in_error'))),
    ).toEqual({ status: 409, reason: 'request_closed' });
    expect(
      await rows(
        tenant,
        `SELECT 1 FROM app.audit_event WHERE action = 'platform.approval.withdrawn' AND entity_id = $1`,
        [id],
      ),
    ).toHaveLength(1);
  });
});

describe('state and read', () => {
  it('audits a read only where the definition makes reading sensitive', async () => {
    const plain = await ask();
    const sensitive = await ask('crm.sign_off');

    await asActor(service, approver, (w) => w.read(plain));
    await asActor(service, approver, (w) => w.state(sensitive));
    const detail = await asActor(service, approver, (w) => w.read(sensitive));

    expect(detail).toMatchObject({ canDecide: true, canWithdraw: false, status: 'pending' });
    const viewed = (id: string) =>
      rows<{ subject_party_id: string }>(
        tenant,
        `SELECT subject_party_id FROM app.audit_event WHERE action = 'platform.approval.viewed' AND entity_id = $1`,
        [id],
      );
    expect(await viewed(plain)).toHaveLength(0);
    expect(await viewed(sensitive)).toEqual([{ subject_party_id: party }]);
  });
});

describe('list', () => {
  it('shows what the member may decide, and what they made, and nothing they may not', async () => {
    const solo = await createTestTenant();
    const [asker, decider, weak] = await Promise.all([
      addActor(solo, REQUESTER_ROLES),
      addActor(solo),
      addActor(solo, REQUESTER_ROLES),
    ]);
    await switchModule(solo, 'grants');
    await storeDefinition(solo, decider, grantsFlow);
    const [open, hiddenOne, decided] = await Promise.all(
      [0, 1, 2].map(async () => {
        const id = await asActor(service, asker, (w) =>
          w.request({ definitionKey: 'grants.sign_off', stepId: 'sign_off' }),
        );
        links.link(id);
        return id;
      }),
    );
    links.hide(decider, hiddenOne as string);
    await asActor(service, decider, (w) => w.decide(decided as string, { outcome: 'approve' }));

    const ids = async (actor: Actor, view: 'to_decide' | 'mine') =>
      (await asActor(service, actor, (w) => w.list(view))).requests.map(({ id }) => id).sort();

    expect(await ids(decider, 'to_decide')).toEqual([open]);
    expect(await ids(decider, 'mine')).toEqual([]);
    // The step needs a permission this member does not hold; the requester made them.
    expect(await ids(weak, 'to_decide')).toEqual([]);
    expect(await ids(asker, 'to_decide')).toEqual([]);
    expect(await ids(asker, 'mine')).toEqual([open, hiddenOne].sort());
  });

  it('pages oldest first with a cursor, without repeating or skipping a request', async () => {
    const paged = await createTestTenant();
    const [asker, decider] = await Promise.all([addActor(paged, REQUESTER_ROLES), addActor(paged)]);
    await switchModule(paged, 'grants');
    await storeDefinition(paged, decider, grantsFlow);
    const made = await asActor(service, asker, async (w) => {
      const ids: string[] = [];
      for (let n = 0; n < 51; n += 1) {
        ids.push(await w.request({ definitionKey: 'grants.sign_off', stepId: 'sign_off' }));
      }
      return ids;
    });
    for (const id of made) links.link(id);

    const first = await asActor(service, decider, (w) => w.list('to_decide'));
    const next = await asActor(service, decider, (w) =>
      w.list('to_decide', first.nextCursor ?? ''),
    );

    expect(first.requests).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(next.requests).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect([...first.requests, ...next.requests].map(({ id }) => id).sort()).toEqual(
      [...made].sort(),
    );
    expect(
      await refusedAs(asActor(service, decider, (w) => w.list('to_decide', 'not a cursor'))),
    ).toMatchObject({ status: 400 });
  });

  it('leaves out a request whose module the tenant has switched off, and brings it back when on', async () => {
    const switched = await createTestTenant();
    const [asker, decider] = await Promise.all([
      addActor(switched, REQUESTER_ROLES),
      addActor(switched),
    ]);
    await switchModule(switched, 'grants');
    await switchModule(switched, 'crm');
    await storeDefinition(switched, decider, grantsFlow);
    await storeDefinition(switched, decider, crmFlow);
    const made = await Promise.all(
      ['grants.sign_off', 'crm.sign_off'].map(async (key) => {
        const id = await asActor(service, asker, (w) =>
          w.request({ definitionKey: key, stepId: 'sign_off' }),
        );
        links.link(id);
        return id;
      }),
    );

    for (const [module, id] of [
      ['grants', made[0]],
      ['crm', made[1]],
    ] as const) {
      await switchModule(switched, module, false);
      for (const work of [
        (w: ReturnType<typeof service>) => w.state(id as string),
        (w: ReturnType<typeof service>) => w.read(id as string),
        (w: ReturnType<typeof service>) => w.decide(id as string, { outcome: 'approve' }),
      ]) {
        expect(await refusedAs(asActor(service, decider, work)), module).toMatchObject({
          status: 404,
        });
      }
      expect(
        await refusedAs(asActor(service, asker, (w) => w.withdraw(id as string, 'made_in_error'))),
      ).toMatchObject({ status: 404 });
      const listed = await asActor(service, decider, (w) => w.list('to_decide'));
      expect(listed.requests.map(({ id: listedId }) => listedId)).not.toContain(id);
      await switchModule(switched, module, true);
    }
  });
});

describe('the tenant boundary', () => {
  it("shows another tenant's member nothing of this tenant's requests", async () => {
    const id = await ask();

    for (const work of [
      (w: ReturnType<typeof service>) => w.state(id),
      (w: ReturnType<typeof service>) => w.read(id),
      (w: ReturnType<typeof service>) => w.decide(id, { outcome: 'approve' }),
      (w: ReturnType<typeof service>) => w.withdraw(id, 'made_in_error'),
    ]) {
      expect(await refusedAs(asActor(service, outsider, work))).toMatchObject({ status: 404 });
    }
    expect((await asActor(service, outsider, (w) => w.list('to_decide'))).requests).toEqual([]);
    expect((await asActor(service, outsider, (w) => w.list('mine'))).requests).toEqual([]);
  });

  it("refuses a decision row in one tenant that points at another tenant's request", async () => {
    const id = await ask();

    const result = await asMember(other.id, outsider, (client) =>
      attempt(
        client,
        `INSERT INTO app.approval_decision (tenant_id, request_id, decided_by, outcome)
         VALUES ($1, $2, $3, 'approve')`,
        [other.id, id, outsider.id],
      ),
    );

    expect(result).not.toBe('ok');
  });

  it('treats an id that is no request as a missing one', async () => {
    expect(await refusedAs(asActor(service, approver, (w) => w.state(randomUUID())))).toMatchObject(
      { status: 404 },
    );
    expect(await refusedAs(asActor(service, approver, (w) => w.state('not-an-id')))).toMatchObject({
      status: 404,
    });
  });
});
