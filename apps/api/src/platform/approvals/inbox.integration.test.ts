// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The approvals inbox through the whole API against the test database
// (ADR 0038): the policy, the step-up the decide routes need, idempotent
// replay, the module-off and cross-tenant answers, and the audit events. The
// session is a stand-in; the member behind it has a real one, which the
// database triggers read.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  inTenantAs,
  kindOf,
  Links,
  REQUESTER_ROLES,
  serviceFor,
  storeDefinition,
  type Actor,
} from '../../../test/approvals-support.ts';
import { switchModule } from '../../../test/modules-on.ts';
import { expectLooksMissing, testAuth, testSession } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { createLogger } from '../../logger.ts';
import { inboxRoutes } from './index.ts';

const links = new Links();
const grantsFlow = flow('grants.sign_off', 'grants.data.export');
const crmFlow = flow('crm.sign_off', 'crm.records.export', { approvers: 2, sensitiveRead: true });
const { service, published } = serviceFor([kindOf(grantsFlow, links), kindOf(crmFlow, links)]);
const stand = testAuth();

let api: FastifyInstance;
let acting: Actor | undefined;
let tenant: TestTenant;
let other: TestTenant;
let requester: Actor;
let approver: Actor;
let second: Actor;
let admin: Actor;
let outsider: Actor;
let party: string;

const rows = <T>(target: TestTenant, query: string, values: unknown[] = []): Promise<T[]> =>
  asMigratorIn(target.id, async (client) => (await client.query(query, values)).rows as T[]);

/** A request as `who`, who signed in again a minute ago unless `fresh` is false. */
async function call(
  who: Actor,
  method: 'GET' | 'POST',
  path: string,
  options: { payload?: object; fresh?: boolean; key?: string } = {},
): Promise<LightMyRequestResponse> {
  const session = testSession({
    userId: who.userId,
    tenant: who.tenant.id,
    recentAuthAt: options.fresh === false ? null : new Date(Date.now() - 60_000),
  });
  acting = who;
  return api.inject({
    method,
    url: `/api/console/approvals${path}`,
    headers: {
      ...stand.as({ app: 'console', session }),
      ...(method === 'POST' ? { 'idempotency-key': options.key ?? randomUUID() } : {}),
    },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

async function ask(key = 'grants.sign_off', by: Actor = requester): Promise<string> {
  const id = await asActor(service, by, (w) =>
    w.request({ definitionKey: key, stepId: 'sign_off', subjectPartyId: party }),
  );
  links.link(id, party);
  return id;
}

const decisions = async (id: string): Promise<number> =>
  (await rows(tenant, 'SELECT 1 FROM app.approval_decision WHERE request_id = $1', [id])).length;

beforeAll(async () => {
  [tenant, other] = await Promise.all([createTestTenant(), createTestTenant()]);
  [requester, approver, second, admin, outsider] = await Promise.all([
    addActor(tenant, REQUESTER_ROLES),
    addActor(tenant),
    addActor(tenant),
    addActor(tenant, ['tenant_admin']),
    addActor(other),
  ]);
  for (const target of [tenant, other]) {
    await switchModule(target, 'grants');
    await switchModule(target, 'crm');
  }
  party = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
  await storeDefinition(tenant, approver, grantsFlow);
  await storeDefinition(tenant, approver, crmFlow);

  api = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => Promise.resolve(),
    inTenant: inTenantAs(() => acting),
    auth: stand.module,
    workflow: service,
    routes: inboxRoutes,
  });
}, 60_000);

afterAll(async () => {
  await api.close();
});

describe('listing and reading', () => {
  it('lists what the member may decide, and what they made, and reads one with its decisions', async () => {
    const id = await ask();

    const toDecide = await call(approver, 'GET', '');
    const mine = await call(requester, 'GET', '?view=mine');
    const none = await call(requester, 'GET', '');

    expect(toDecide.statusCode).toBe(200);
    expect(toDecide.json<{ requests: { id: string }[] }>().requests.map((r) => r.id)).toContain(id);
    expect(mine.json<{ requests: { id: string }[] }>().requests.map((r) => r.id)).toContain(id);
    expect(none.json<{ requests: { id: string }[] }>().requests.map((r) => r.id)).not.toContain(id);

    const read = await call(approver, 'GET', `/${id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      id,
      status: 'pending',
      stepId: 'sign_off',
      requestedBy: requester.id,
      canDecide: true,
      canWithdraw: false,
      decisions: [],
    });
  });

  it('carries ids, codes, counts and times only', async () => {
    const id = await ask();

    const body = (await call(approver, 'GET', `/${id}`)).json<Record<string, unknown>>();

    expect(Object.keys(body).sort()).toEqual(
      [
        'approvals',
        'canDecide',
        'canWithdraw',
        'closeReason',
        'closedAt',
        'decisions',
        'definitionKey',
        'definitionVersionId',
        'dueAt',
        'id',
        'requestedAt',
        'requestedBy',
        'requiredApprovals',
        'status',
        'stepId',
        'subjectId',
      ].sort(),
    );
  });

  it('audits a read of a request whose definition makes it sensitive, with the subject party', async () => {
    const id = await ask('crm.sign_off');

    await call(approver, 'GET', `/${id}`);

    expect(
      await rows(
        tenant,
        `SELECT 1 FROM app.audit_event
          WHERE action = 'platform.approval.viewed' AND entity_id = $1 AND subject_party_id = $2`,
        [id, party],
      ),
    ).toHaveLength(1);
  });
});

describe('deciding', () => {
  it('approves with a step-up, and replaying the key returns the stored result without a second decision', async () => {
    const id = await ask();
    const key = randomUUID();
    published.length = 0;

    const first = await call(approver, 'POST', `/${id}/approve`, { key });
    const replay = await call(approver, 'POST', `/${id}/approve`, { key });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ id, status: 'approved', approvals: 1 });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(await decisions(id)).toBe(1);
    expect(published).toHaveLength(1);
    expect(
      await rows<{ actor_id: string }>(
        tenant,
        `SELECT actor_id FROM app.audit_event WHERE action = 'platform.approval.approved' AND entity_id = $1`,
        [id],
      ),
    ).toEqual([{ actor_id: approver.id }]);
  });

  it('rejects with a reason code from the list, and refuses any other body', async () => {
    const id = await ask();

    const bad = await call(approver, 'POST', `/${id}/reject`, { payload: { reasonCode: 'rude' } });
    const extra = await call(approver, 'POST', `/${id}/reject`, {
      payload: { reasonCode: 'duplicate', approverId: approver.id },
    });
    const good = await call(approver, 'POST', `/${id}/reject`, {
      payload: { reasonCode: 'outside_policy' },
    });

    expect(bad.statusCode).toBe(400);
    expect(extra.statusCode).toBe(400);
    expect(good.statusCode).toBe(201);
    expect(good.json()).toMatchObject({
      status: 'rejected',
      decisions: [{ outcome: 'reject', reasonCode: 'outside_policy', decidedBy: approver.id }],
    });
  });

  it('refuses a decision without a recent step-up, before the handler, and writes nothing', async () => {
    const id = await ask();

    const response = await call(approver, 'POST', `/${id}/approve`, { fresh: false });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ detail: string }>().detail).toBe(
      'Confirm it is you again, then try again.',
    );
    expect(await decisions(id)).toBe(0);
  });

  it('refuses the requester and a member without the step permission, with words that fix it', async () => {
    const id = await ask('crm.sign_off');

    const own = await call(requester, 'POST', `/${id}/approve`);
    const madeByApprover = await ask('crm.sign_off', approver);
    const weak = await call(requester, 'POST', `/${madeByApprover}/approve`);

    expect(own.statusCode).toBe(403);
    expect(own.json<{ detail: string }>().detail).toBe(
      'You made this request, so someone else must decide it.',
    );
    expect(weak.statusCode).toBe(403);
    expect(await decisions(id)).toBe(0);
    expect(await decisions(madeByApprover)).toBe(0);
  });

  it('refuses a member without the approvals permissions at the policy', async () => {
    const id = await ask();

    for (const response of [
      await call(admin, 'GET', ''),
      await call(admin, 'GET', `/${id}`),
      await call(admin, 'POST', `/${id}/approve`),
      await call(admin, 'POST', `/${id}/reject`, { payload: { reasonCode: 'duplicate' } }),
      await call(admin, 'POST', `/${id}/withdraw`, { payload: { reasonCode: 'made_in_error' } }),
    ]) {
      expect(response.statusCode).toBe(403);
    }
    expect(await decisions(id)).toBe(0);
  });

  it('takes the second approver of a two-approver step as the one that closes it', async () => {
    const id = await ask('crm.sign_off');

    const first = await call(approver, 'POST', `/${id}/approve`);
    const again = await call(approver, 'POST', `/${id}/approve`);
    const last = await call(second, 'POST', `/${id}/approve`);

    expect(first.json()).toMatchObject({ status: 'pending', approvals: 1, canDecide: false });
    expect(again.statusCode).toBe(409);
    expect(last.json()).toMatchObject({ status: 'approved', approvals: 2 });
  });
});

describe('withdrawing', () => {
  it('is the requester alone, once', async () => {
    const id = await ask();

    const by = await call(approver, 'POST', `/${id}/withdraw`, {
      payload: { reasonCode: 'made_in_error' },
    });
    const removed = await call(requester, 'POST', `/${id}/withdraw`, {
      payload: { reasonCode: 'requester_removed' },
    });
    const own = await call(requester, 'POST', `/${id}/withdraw`, {
      payload: { reasonCode: 'no_longer_needed' },
    });
    const twice = await call(requester, 'POST', `/${id}/withdraw`, {
      payload: { reasonCode: 'no_longer_needed' },
    });

    expect(by.statusCode).toBe(403);
    expect(removed.statusCode).toBe(400);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ status: 'withdrawn', closeReason: 'no_longer_needed' });
    expect(twice.statusCode).toBe(409);
  });
});

describe('a module that is switched off', () => {
  it.each(['grants', 'crm'] as const)(
    'answers %s requests as missing everywhere',
    async (module) => {
      const off = await createTestTenant();
      const [asker, decider] = await Promise.all([addActor(off, REQUESTER_ROLES), addActor(off)]);
      await switchModule(off, module);
      await storeDefinition(off, decider, module === 'grants' ? grantsFlow : crmFlow);
      const id = await asActor(service, asker, (w) =>
        w.request({ definitionKey: `${module}.sign_off`, stepId: 'sign_off' }),
      );
      links.link(id);
      await switchModule(off, module, false);
      const missing = await call(decider, 'GET', `/${randomUUID()}`);

      const read = await call(decider, 'GET', `/${id}`);
      expectLooksMissing(read, missing);
      expect((await call(decider, 'POST', `/${id}/approve`)).statusCode).toBe(404);
      expect(
        (await call(decider, 'POST', `/${id}/reject`, { payload: { reasonCode: 'duplicate' } }))
          .statusCode,
      ).toBe(404);
      expect(
        (await call(asker, 'POST', `/${id}/withdraw`, { payload: { reasonCode: 'made_in_error' } }))
          .statusCode,
      ).toBe(404);
      expect((await call(decider, 'GET', '')).json<{ requests: unknown[] }>().requests).toEqual([]);
    },
  );
});

describe('the tenant boundary', () => {
  it("answers another tenant's member as it answers a missing request, on every route", async () => {
    const id = await ask();
    const nobody = randomUUID();
    const reject = { payload: { reasonCode: 'duplicate' } };
    const withdraw = { payload: { reasonCode: 'made_in_error' } };

    expectLooksMissing(
      await call(outsider, 'GET', `/${id}`),
      await call(outsider, 'GET', `/${nobody}`),
    );
    expectLooksMissing(
      await call(outsider, 'POST', `/${id}/approve`),
      await call(outsider, 'POST', `/${nobody}/approve`),
    );
    expectLooksMissing(
      await call(outsider, 'POST', `/${id}/reject`, reject),
      await call(outsider, 'POST', `/${nobody}/reject`, reject),
    );
    expectLooksMissing(
      await call(outsider, 'POST', `/${id}/withdraw`, withdraw),
      await call(outsider, 'POST', `/${nobody}/withdraw`, withdraw),
    );
    expect((await call(outsider, 'GET', '')).json()).toEqual({ requests: [], nextCursor: null });
    expect(await decisions(id)).toBe(0);
  });

  it('refuses a member outside the subject scope as a missing request', async () => {
    const id = await ask();
    links.hide(second, id);

    expectLooksMissing(
      await call(second, 'GET', `/${id}`),
      await call(second, 'GET', `/${randomUUID()}`),
    );
    expect((await call(second, 'POST', `/${id}/approve`)).statusCode).toBe(404);
  });
});
