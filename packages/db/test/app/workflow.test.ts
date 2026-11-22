// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stored workflow definitions and approval requests (migrations 0093, 0094
// and 0096, ADR 0038): isolation, append-only definitions that only the
// session's member writes and a later version never weakens, requests that
// copy their pinned version and only the session's member can make, the
// closings the database allows, and a module link table's keys and check.

import {
  decisionOutcomes,
  MAX_APPROVERS,
  rejectionReasons,
  requestStatuses,
  withdrawalReasons,
} from '@pixel-scientists/domain/workflow';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorRolledBack, withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  type Row,
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
  definitionDocument,
  uniqueKey,
  type Member,
} from './workflow-fixtures.ts';

let tenant: TestTenant;
let other: TestTenant;
let admin: Member;
let requester: Member;
let approver: Member;
/** A member whose session last signed in again 6 minutes ago. */
let stale: Member;
/** Members whose sessions must not let them act, by what is wrong. */
let unfit: Record<string, Member>;
/** The latest of two versions (2 approvers, due in 5 days), and the first (1 approver). */
let latest: string;
let earlier: string;
let otherVersion: string;
let otherRequester: Member;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    admin = await addSessionMember(client, tenant);
    requester = await addSessionMember(client, tenant);
    approver = await addSessionMember(client, tenant);
    stale = await addSessionMember(client, tenant, { reauthenticated: '6 minutes' });
    const suspended = await addSessionMember(client, tenant);
    await client.query("UPDATE app.membership SET status = 'suspended' WHERE id = $1", [
      suspended.id,
    ]);
    unfit = {
      'a session waiting for MFA': await addSessionMember(client, tenant, { mfaState: 'verify' }),
      'a portal session': await addSessionMember(client, tenant, { app: 'portal' }),
      'a revoked session': await addSessionMember(client, tenant, { revoked: true }),
      'a session in another tenant': await addSessionMember(client, tenant, {
        activeTenant: other.id,
      }),
      'a suspended member': suspended,
    };
  });
  [earlier = '', latest = ''] = await addDefinition(tenant, admin, [1, 2], 5);
  otherRequester = await asMigratorIn(other.id, (client) => addSessionMember(client, other));
  [otherVersion = ''] = await addDefinition(other, otherRequester, [1]);
}, 60_000);

/** The tokens of members made by the cross-tenant factories, by membership id. */
const members = new Map<string, Member>();
const memberOf = (id: unknown) => members.get(String(id)) as Member;

/** Add and commit a member of `owner` with a session, for a cross-tenant factory. */
async function sessionMemberOf(owner: TestTenant): Promise<Member> {
  const member = await asMigratorIn(owner.id, (client) => addSessionMember(client, owner));
  members.set(member.id, member);
  return member;
}

describe('workflow and approval tables', { timeout: 60_000 }, () => {
  it("keep each tenant's definitions, versions and requests from every other tenant", async () => {
    await expectCrossTenantDenial(
      'app.workflow_definition',
      async (_client, owner) => ({
        tenant_id: owner.id,
        key: uniqueKey(),
        created_by: (await sessionMemberOf(owner)).id,
      }),
      (owner, row) =>
        committedAs(owner.id, memberOf(row.created_by), (client) =>
          insertRow(client, 'app.workflow_definition', row),
        ),
    );
    await expectCrossTenantDenial(
      'app.workflow_definition_version',
      async (_client, owner) => {
        const key = uniqueKey();
        const author = await sessionMemberOf(owner);
        const definition = await committedAs(owner.id, author, (client) =>
          insertRow(client, 'app.workflow_definition', {
            tenant_id: owner.id,
            key,
            created_by: author.id,
          }),
        );
        return {
          tenant_id: owner.id,
          definition_id: definition,
          version: 1,
          document: definitionDocument(key, 1, 1),
          created_by: author.id,
        };
      },
      (owner, row) =>
        committedAs(owner.id, memberOf(row.created_by), (client) =>
          insertRow(client, 'app.workflow_definition_version', row),
        ),
    );
    await expectCrossTenantDenial(
      'app.approval_request',
      async (_client, owner) => {
        const member = await sessionMemberOf(owner);
        const [version] = await addDefinition(owner, member, [1]);
        return {
          tenant_id: owner.id,
          definition_version_id: version,
          step_id: 'release',
          requested_by: member.id,
        };
      },
      (owner, row) =>
        committedAs(owner.id, memberOf(row.requested_by), (client) =>
          insertRow(client, 'app.approval_request', row),
        ),
    );
  });

  it('copy every list and limit in the checks from the domain package', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ name: string; definition: string }>(
        `SELECT o.conname AS name, pg_catalog.pg_get_constraintdef(o.oid) AS definition
           FROM pg_catalog.pg_constraint o
          WHERE o.conrelid IN ('app.approval_request'::regclass, 'app.approval_decision'::regclass)
            AND o.contype = 'c'`,
      ),
    );
    const checks = new Map(rows.map((row) => [row.name, row.definition]));
    const literals = (name: string) =>
      [...(checks.get(name) ?? '').matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]).sort();
    expect(literals('approval_request_status_check')).toEqual([...requestStatuses].sort());
    expect(literals('approval_request_close_reason_check')).toEqual([...withdrawalReasons].sort());
    expect(literals('approval_decision_outcome_check')).toEqual([...decisionOutcomes].sort());
    expect(literals('approval_decision_reason_code_check')).toEqual([...rejectionReasons].sort());
    expect(checks.get('approval_request_required_approvals')).toBe(
      `CHECK (((required_approvals >= 1) AND (required_approvals <= ${String(MAX_APPROVERS)})))`,
    );
  });

  it('let app_api add definitions and versions, but no app role change or remove one', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        for (const table of ['app.workflow_definition', 'app.workflow_definition_version']) {
          expect(await attempt(client, `UPDATE ${table} SET created_by = created_by`), role).toBe(
            '42501',
          );
          expect(await attempt(client, `DELETE FROM ${table}`), role).toBe('42501');
        }
      });
    }
  });
});

describe('stored workflow definitions', { timeout: 60_000 }, () => {
  const addDefinitionRow = `INSERT INTO app.workflow_definition (tenant_id, key, created_by)
                            VALUES ($1, $2, $3)`;
  /** Add a version of `latest`'s definition. */
  const addVersion = `INSERT INTO app.workflow_definition_version
                        (tenant_id, definition_id, version, document, created_by)
                      SELECT tenant_id, definition_id, $2, $3::jsonb, $4
                        FROM app.workflow_definition_version WHERE id = $1`;

  /** `latest`'s key, and how many versions its definition has. */
  async function definitionOf(client: pg.ClientBase): Promise<{ key: string; versions: number }> {
    const { rows } = await client.query<{ key: string; versions: number }>(
      `SELECT d.key, (SELECT count(*)::integer FROM app.workflow_definition_version w
                       WHERE w.definition_id = d.id) AS versions
         FROM app.workflow_definition_version v
         JOIN app.workflow_definition d ON d.id = v.definition_id
        WHERE v.id = $1`,
      [latest],
    );
    return rows[0] ?? { key: '', versions: 0 };
  }

  /** A document for `version` of `key` whose steps `steps` makes from the `release` step. */
  function withSteps(key: string, version: number, steps: (step: Row) => unknown[]): Row {
    const document = definitionDocument(key, version, 2, 5);
    const [release = {}] = document.approvalSteps as Row[];
    return { ...document, approvalSteps: steps(release) };
  }

  it('refuses an author other than the member of a live console session past MFA', async () => {
    await asMember(tenant.id, requester, async (client) => {
      const { key, versions } = await definitionOf(client);
      const fresh = uniqueKey();
      const third = definitionDocument(key, 3, 2, 5);
      expect(await attempt(client, addDefinitionRow, [tenant.id, fresh, admin.id])).toBe(
        '42501 workflow_definition_actor',
      );
      expect(await attempt(client, addVersion, [latest, 3, third, admin.id])).toBe(
        '42501 workflow_definition_version_actor',
      );
      await client.query("SELECT pg_catalog.set_config('app.membership_id', $1, true)", [admin.id]);
      expect(await attempt(client, addVersion, [latest, 3, third, admin.id])).toBe(
        '42501 workflow_definition_version_actor',
      );
      await actAs(client, undefined);
      expect(await attempt(client, addDefinitionRow, [tenant.id, fresh, requester.id])).toBe(
        '42501 workflow_definition_actor',
      );
      for (const [why, member] of Object.entries(unfit)) {
        await actAs(client, member);
        expect(await attempt(client, addDefinitionRow, [tenant.id, fresh, member.id]), why).toBe(
          '42501 workflow_definition_actor',
        );
        expect(await attempt(client, addVersion, [latest, 3, third, member.id]), why).toBe(
          '42501 workflow_definition_version_actor',
        );
      }
      expect(await definitionOf(client)).toEqual({ key, versions });
      const { rowCount } = await client.query(
        'SELECT FROM app.workflow_definition WHERE key = $1',
        [fresh],
      );
      expect(rowCount).toBe(0);
    });
  });

  it('needs a step-up in the last 5 minutes for every version after the first', async () => {
    await asMember(tenant.id, stale, async (client) => {
      const { key, versions } = await definitionOf(client);
      expect(
        await attempt(client, addVersion, [latest, 3, definitionDocument(key, 3, 3, 5), stale.id]),
      ).toBe('42501 workflow_definition_version_step_up');
      expect(await definitionOf(client)).toEqual({ key, versions });
      const fresh = uniqueKey();
      const definition = await insertRow(client, 'app.workflow_definition', {
        tenant_id: tenant.id,
        key: fresh,
        created_by: stale.id,
      });
      const first = `INSERT INTO app.workflow_definition_version
                       (tenant_id, definition_id, version, document, created_by)
                     VALUES ($1, $2, 1, $3::jsonb, $4)`;
      const document = definitionDocument(fresh, 1, 2);
      expect(await attempt(client, first, [tenant.id, definition, document, stale.id])).toBe('ok');
    });
  });

  it('numbers the versions of a definition one after another', async () => {
    await asMember(tenant.id, admin, async (client) => {
      const { key, versions } = await definitionOf(client);
      for (const version of [1, 2, 4]) {
        const document = definitionDocument(key, version, 2, 5);
        expect(
          await attempt(client, addVersion, [latest, version, document, admin.id]),
          String(version),
        ).toBe('23514 workflow_definition_version_sequence');
      }
      expect(await definitionOf(client)).toEqual({ key, versions });
    });
  });

  it.each<[string, (step: Row) => unknown[], string]>([
    ['lowers a count', (step) => [{ ...step, approvers: 1 }], 'weaker'],
    ['removes a step', () => [], 'weaker'],
    ['renames a step', (step) => [{ ...step, id: 'pay' }], 'weaker'],
    ['adds a step', (step) => [step, { ...step, id: 'pay' }], 'weaker'],
    ['needs 6 approvers', (step) => [{ ...step, approvers: 6 }], 'approvers'],
    ['needs 2.5 approvers', (step) => [{ ...step, approvers: 2.5 }], 'approvers'],
    ['gives the count as text', (step) => [{ ...step, approvers: '3' }], 'approvers'],
    ['has no count', (step) => [{ ...step, approvers: undefined }], 'approvers'],
  ])('refuses a version that %s, with nothing written', async (_why, steps, check) => {
    await asMember(tenant.id, admin, async (client) => {
      const { key, versions } = await definitionOf(client);
      const document = withSteps(key, 3, steps);
      expect(await attempt(client, addVersion, [latest, 3, document, admin.id])).toBe(
        `23514 workflow_definition_version_${check}`,
      );
      expect(await definitionOf(client)).toEqual({ key, versions });
    });
  });

  it.each<[string, (document: Row) => Row]>([
    [
      "changes a step's permission",
      (document) => ({
        ...document,
        approvalSteps: (document.approvalSteps as Row[]).map((step) => ({
          ...step,
          permission: 'finance.read',
        })),
      }),
    ],
    [
      'flips movesMoney',
      (document) => ({
        ...document,
        approvalSteps: (document.approvalSteps as Row[]).map((step) => ({
          ...step,
          movesMoney: false,
        })),
      }),
    ],
    [
      "changes a transition's permission",
      (document) => ({
        ...document,
        transitions: (document.transitions as Row[]).map((transition) => ({
          ...transition,
          permission: 'finance.read',
        })),
      }),
    ],
    ['drops its states', (document) => ({ ...document, states: undefined })],
  ])('refuses a version that %s, with nothing written', async (_why, change) => {
    await asMember(tenant.id, admin, async (client) => {
      const { key, versions } = await definitionOf(client);
      const document = change(definitionDocument(key, 3, 3, 5));
      expect(await attempt(client, addVersion, [latest, 3, document, admin.id])).toBe(
        '23514 workflow_definition_version_weaker',
      );
      expect(await definitionOf(client)).toEqual({ key, versions });
    });
  });

  it("keeps a requester from lowering their step's count, so a request still needs it", async () => {
    await asMember(tenant.id, requester, async (client) => {
      const { key } = await definitionOf(client);
      const lowered = definitionDocument(key, 3, 1, 5);
      expect(await attempt(client, addVersion, [latest, 3, lowered, admin.id])).toBe(
        '42501 workflow_definition_version_actor',
      );
      expect(await attempt(client, addVersion, [latest, 3, lowered, requester.id])).toBe(
        '23514 workflow_definition_version_weaker',
      );
      const id = await ask(client, tenant.id, latest, requester);
      const { rows } = await client.query(
        'SELECT required_approvals FROM app.approval_request WHERE id = $1',
        [id],
      );
      expect(rows).toEqual([{ required_approvals: 2 }]);
    });
  });

  it('accepts a version that keeps or raises every count, and requests then need it', async () => {
    await asMember(tenant.id, admin, async (client) => {
      const { key } = await definitionOf(client);
      const kept = definitionDocument(key, 3, 2, 5);
      expect(await attempt(client, addVersion, [latest, 3, kept, admin.id])).toBe('ok');
      const raised = withSteps(key, 3, (step) => [
        { ...step, approvers: 3, dueAfterDays: 1, remindAfterDays: 2 },
      ]);
      expect(await attempt(client, addVersion, [latest, 3, raised, admin.id], true)).toBe('ok');
      const { rows } = await client.query<{ id: string }>(
        `SELECT v.id FROM app.workflow_definition_version v
          WHERE v.definition_id = (SELECT w.definition_id FROM app.workflow_definition_version w
                                    WHERE w.id = $1)
            AND v.version = 3`,
        [latest],
      );
      await actAs(client, requester);
      const id = await ask(client, tenant.id, rows[0]?.id ?? '', requester);
      const stored = await client.query(
        'SELECT required_approvals FROM app.approval_request WHERE id = $1',
        [id],
      );
      expect(stored.rows).toEqual([{ required_approvals: 3 }]);
    });
  });
});

describe('app.approval_request', { timeout: 60_000 }, () => {
  it("stores the pinned version's key, count and due date, pending", async () => {
    await asMember(tenant.id, requester, async (client) => {
      const id = await ask(client, tenant.id, latest, requester);
      const { rows } = await client.query(
        `SELECT r.definition_key = d.key AS own_key, r.required_approvals, r.status,
                r.requested_at = now() AS asked_now, r.due_at = now() + interval '5 days' AS due,
                r.closed_at, r.retain_until
           FROM app.approval_request r
           JOIN app.workflow_definition_version v ON v.id = r.definition_version_id
           JOIN app.workflow_definition d ON d.id = v.definition_id
          WHERE r.id = $1`,
        [id],
      );
      expect(rows).toEqual([
        {
          own_key: true,
          required_approvals: 2,
          status: 'pending',
          asked_now: true,
          due: true,
          closed_at: null,
          retain_until: null,
        },
      ]);
    });
  });

  it.each([
    ['definition_key', "'finance.other'"],
    ['required_approvals', '1'],
    ['status', "'approved'"],
    ['requested_at', 'now()'],
    ['due_at', 'now()'],
    ['closed_by', '$1'],
    ['retain_until', 'now()'],
  ])('refuses an insert that sets %s', async (column, value) => {
    await asMember(tenant.id, requester, async (client) => {
      const text = `INSERT INTO app.approval_request
                      (tenant_id, definition_version_id, step_id, requested_by, ${column})
                    VALUES ($2, $3, 'release', $1, ${value})`;
      expect(await attempt(client, text, [requester.id, tenant.id, latest])).toBe('42501');
    });
  });

  it('refuses a version that is not the latest, and a step it does not have', async () => {
    await asMember(tenant.id, requester, async (client) => {
      const insert = `INSERT INTO app.approval_request
                        (tenant_id, definition_version_id, step_id, requested_by)
                      VALUES ($1, $2, $3, $4)`;
      expect(await attempt(client, insert, [tenant.id, earlier, 'release', requester.id])).toBe(
        '23514 approval_request_latest_version',
      );
      expect(await attempt(client, insert, [tenant.id, latest, 'pay', requester.id])).toBe(
        '23514 approval_request_step',
      );
      expect(
        await attempt(client, insert, [tenant.id, otherVersion, 'release', requester.id]),
      ).toBe('23514 approval_request_latest_version');
    });
  });

  it('refuses a requester other than the member of a live console session past MFA', async () => {
    const insert = `INSERT INTO app.approval_request
                      (tenant_id, definition_version_id, step_id, requested_by)
                    VALUES ($1, $2, 'release', $3)`;
    await asMember(tenant.id, requester, async (client) => {
      expect(await attempt(client, insert, [tenant.id, latest, approver.id])).toBe(
        '42501 approval_request_actor',
      );
      await client.query("SELECT pg_catalog.set_config('app.membership_id', $1, true)", [
        approver.id,
      ]);
      expect(await attempt(client, insert, [tenant.id, latest, approver.id])).toBe(
        '42501 approval_request_actor',
      );
      await actAs(client, undefined);
      expect(await attempt(client, insert, [tenant.id, latest, requester.id])).toBe(
        '42501 approval_request_actor',
      );
      for (const [why, member] of Object.entries(unfit)) {
        await actAs(client, member);
        expect(await attempt(client, insert, [tenant.id, latest, member.id]), why).toBe(
          '42501 approval_request_actor',
        );
      }
    });
    await asMember(tenant.id, otherRequester, async (client) => {
      expect(await attempt(client, insert, [tenant.id, latest, otherRequester.id])).toBe(
        '42501 approval_request_actor',
      );
    });
  });

  it('lets no app role delete a request, and app_worker neither add nor change one', async () => {
    const id = await committedAs(tenant.id, requester, (client) =>
      ask(client, tenant.id, latest, requester),
    );
    await asMember(tenant.id, requester, async (client) => {
      expect(await attempt(client, 'DELETE FROM app.approval_request WHERE id = $1', [id])).toBe(
        '42501',
      );
    });
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await attempt(client, 'DELETE FROM app.approval_request WHERE id = $1', [id])).toBe(
        '42501',
      );
      expect(await attempt(client, "UPDATE app.approval_request SET status = 'withdrawn'")).toBe(
        '42501',
      );
      expect(
        await attempt(
          client,
          `INSERT INTO app.approval_request (tenant_id, definition_version_id, step_id, requested_by)
           VALUES ($1, $2, 'release', $3)`,
          [tenant.id, latest, requester.id],
        ),
      ).toBe('42501');
    });
  });
});

describe('closing an approval request', { timeout: 60_000 }, () => {
  const close = `UPDATE app.approval_request SET status = $2, closed_by = $3, close_reason = $4
                  WHERE id = $1`;

  it('fixes every column but the closing ones, and a pending update changes nothing', async () => {
    await asMember(tenant.id, requester, async (client) => {
      const id = await ask(client, tenant.id, latest, requester);
      for (const set of [
        'requested_by = $2',
        'required_approvals = 1',
        "definition_key = 'finance.other'",
        "step_id = 'other'",
        'definition_version_id = definition_version_id',
        'closed_at = now()',
      ]) {
        const text = `UPDATE app.approval_request SET ${set} WHERE id = $1`;
        const values = set.includes('$2') ? [id, approver.id] : [id];
        expect(await attempt(client, text, values), set).toBe('42501');
      }
      expect(
        await attempt(client, "UPDATE app.approval_request SET status = 'pending' WHERE id = $1", [
          id,
        ]),
      ).toBe('ok');
      expect(await attempt(client, close, [id, 'pending', requester.id, null])).toBe(
        '23514 approval_request_closing',
      );
    });
  });

  it('lets only the requester withdraw, with a code, and never changes a closed request', async () => {
    await asMember(tenant.id, requester, async (client) => {
      const id = await ask(client, tenant.id, latest, requester);
      expect(await attempt(client, close, [id, 'withdrawn', approver.id, 'made_in_error'])).toBe(
        '42501 approval_request_actor',
      );
      expect(
        await attempt(client, close, [id, 'withdrawn', requester.id, 'requester_removed']),
      ).toBe('23514 approval_request_closing');
      expect(await attempt(client, close, [id, 'withdrawn', requester.id, null])).toBe(
        '23514 approval_request_closing',
      );
      expect(await attempt(client, close, [id, 'approved', requester.id, null])).toBe(
        '23514 approval_request_closing',
      );
      await actAs(client, approver);
      expect(await attempt(client, close, [id, 'withdrawn', approver.id, 'made_in_error'])).toBe(
        '23514 approval_request_closing',
      );
      await actAs(client, requester);
      await client.query(close, [id, 'withdrawn', requester.id, 'no_longer_needed']);
      const { rows } = await client.query(
        `SELECT closed_at = now() AS closed_now,
                retain_until = ((now() AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC' AS kept
           FROM app.approval_request WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ closed_now: true, kept: true }]);
      expect(await attempt(client, close, [id, 'pending', null, null])).toBe(
        '23514 approval_request_final',
      );
    });
  });

  it("lets the member who removes a requester withdraw the requester's requests", async () => {
    await asMember(tenant.id, requester, async (client) => {
      const id = await ask(client, tenant.id, latest, requester);
      await actAs(client, admin);
      expect(await attempt(client, close, [id, 'withdrawn', admin.id, 'requester_removed'])).toBe(
        '23514 approval_request_closing',
      );
      await client.query("UPDATE app.membership SET status = 'removed' WHERE id = $1", [
        requester.id,
      ]);
      expect(await attempt(client, close, [id, 'withdrawn', admin.id, 'requester_removed'])).toBe(
        'ok',
      );
    });
  });
});

describe('a module link table', { timeout: 60_000 }, () => {
  it("refuses a link to another tenant's request, another step, or a decided request", async () => {
    const [pending, decided, withdrawn] = await committedAs(
      tenant.id,
      requester,
      async (client) => [
        await ask(client, tenant.id, latest, requester),
        await ask(client, tenant.id, latest, requester),
        await ask(client, tenant.id, latest, requester),
      ],
    );
    await committedAs(tenant.id, approver, (client) =>
      decide(client, tenant.id, decided, approver),
    );
    await committedAs(tenant.id, requester, (client) =>
      client.query(
        "UPDATE app.approval_request SET status = 'withdrawn', closed_by = $2, close_reason = 'made_in_error' WHERE id = $1",
        [withdrawn, requester.id],
      ),
    );
    const strangers = await committedAs(other.id, otherRequester, (client) =>
      ask(client, other.id, otherVersion, otherRequester),
    );
    await asMigratorRolledBack(async (client) => {
      await client.query(`
        CREATE TABLE app.approval_subject_check (
          tenant_id uuid NOT NULL, id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          UNIQUE (tenant_id, id));
        CREATE TABLE app.approval_subject_check_approval (
          tenant_id uuid NOT NULL, id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          subject_id uuid NOT NULL, approval_request_id uuid NOT NULL UNIQUE,
          definition_key text NOT NULL CHECK (definition_key LIKE 'finance.%'),
          step_id text NOT NULL,
          FOREIGN KEY (tenant_id, subject_id)
            REFERENCES app.approval_subject_check (tenant_id, id) ON DELETE RESTRICT,
          FOREIGN KEY (tenant_id, approval_request_id, definition_key, step_id)
            REFERENCES app.approval_request (tenant_id, id, definition_key, step_id) ON DELETE RESTRICT);
        CREATE TRIGGER check_approval_link BEFORE INSERT ON app.approval_subject_check_approval
          FOR EACH ROW EXECUTE FUNCTION app.check_approval_link();`);
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
      const subject = await insertRow(client, 'app.approval_subject_check', {
        tenant_id: tenant.id,
      });
      const { rows } = await client.query<{ key: string }>(
        'SELECT definition_key AS key FROM app.approval_request WHERE id = $1',
        [pending],
      );
      const key = rows[0]?.key;
      const link = `INSERT INTO app.approval_subject_check_approval
                      (tenant_id, subject_id, approval_request_id, definition_key, step_id)
                    VALUES ($1, $2, $3, $4, $5)`;
      const code = async (request: unknown, step = 'release', definition = key) =>
        (await attempt(client, link, [tenant.id, subject, request, definition, step])).split(
          ' ',
        )[0];
      expect(await code(strangers)).toBe('23503');
      expect(await code(pending, 'other')).toBe('23503');
      expect(await code(pending, 'release', 'finance.other')).toBe('23503');
      expect(await attempt(client, link, [tenant.id, subject, decided, key, 'release'])).toBe(
        '23514 approval_link_undecided',
      );
      expect(await attempt(client, link, [tenant.id, subject, withdrawn, key, 'release'])).toBe(
        '23514 approval_link_undecided',
      );
      await client.query(link, [tenant.id, subject, pending, key, 'release']);
      expect(await code(pending)).toBe('23505');
      const remove = 'DELETE FROM app.approval_subject_check WHERE id = $1';
      expect((await attempt(client, remove, [subject])).split(' ')[0]).toBe('23503');
    });
  });
});
