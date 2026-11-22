// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Support for the approval tests: members with real sessions, stored
// definitions, two shipped workflows with stand-in link tables, and
// transactions that act as a member's session the way withTenant() will once
// it sets the session token (ADR 0038, S12-70). Until then the token is set
// by the db package's own test fixtures.

import { randomUUID } from 'node:crypto';

import { permissionsFor } from '@pixel-scientists/domain/platform';
import { defineWorkflow, type WorkflowDefinition } from '@pixel-scientists/domain/workflow';

import { kyselyOn } from '../../../packages/db/src/database.ts';
import {
  addSessionMember,
  committedAs,
  type SessionOptions,
} from '../../../packages/db/test/app/workflow-fixtures.ts';
import { asMigratorIn, insertRow, type TestTenant } from '../../../packages/db/test/tenants.ts';
import { recordAudit, recordRead } from '../src/audit/writer.ts';
import type { RequestAudit } from '../src/context.ts';
import type { InTenant, TenantTransaction } from '../src/database.ts';
import type { ApprovalKind, Reader } from '../src/platform/approvals/kinds.ts';
import {
  createWorkflowService,
  type PublishDecided,
  type RequestWorkflow,
  type WorkflowService,
} from '../src/platform/approvals/service.ts';

export interface Actor {
  readonly id: string;
  readonly token: Buffer;
  readonly userId: string;
  readonly tenant: TestTenant;
}

/** Who may decide a step: the programme manager role, plus the export permission the steps below need. */
export const APPROVER_ROLES = ['programme_manager', 'tenant_admin'];
/** May ask, and may decide only a step that needs no other permission. */
export const REQUESTER_ROLES = ['programme_manager'];

/** A member of the tenant with a live console session past MFA. */
export async function addActor(
  tenant: TestTenant,
  roles: readonly string[] = APPROVER_ROLES,
  options: SessionOptions = {},
): Promise<Actor> {
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addSessionMember(client, tenant, options);
    await client.query('UPDATE app.membership SET roles = $2 WHERE id = $1', [member.id, roles]);
    const { rows } = await client.query<{ user_id: string }>(
      'SELECT user_id FROM app.membership WHERE id = $1',
      [member.id],
    );
    return { ...member, userId: rows[0]?.user_id ?? '', tenant };
  });
}

export const setRoles = (actor: Actor, roles: readonly string[]): Promise<unknown> =>
  asMigratorIn(actor.tenant.id, (client) =>
    client.query('UPDATE app.membership SET roles = $2 WHERE id = $1', [actor.id, roles]),
  );

/** One approval step, `sign_off`, that needs `stepPermission` besides the right to decide. */
export function flow(
  key: string,
  stepPermission: 'grants.data.export' | 'crm.records.export',
  options: { approvers?: number; sensitiveRead?: boolean } = {},
): WorkflowDefinition {
  const module = key.split('.')[0] === 'crm' ? 'crm' : 'grants';
  return defineWorkflow({
    key,
    version: 1,
    sensitiveRead: options.sensitiveRead ?? false,
    states: [
      { id: 'draft', label: 'Draft' },
      { id: 'done', label: 'Done', terminal: true },
    ],
    initial: 'draft',
    transitions: [
      {
        from: 'draft',
        to: 'done',
        label: 'Finish work',
        permission: module === 'crm' ? 'crm.records.manage' : 'grants.applications.triage',
        approval: 'sign_off',
      },
    ],
    approvalSteps: [
      {
        id: 'sign_off',
        label: 'Sign off the work',
        approveLabel: 'Approve work',
        rejectLabel: 'Reject work',
        permission: stepPermission,
        approvers: options.approvers ?? 1,
        movesMoney: false,
      },
    ],
  });
}

/** What the stand-in link tables hold: the subject of each request, and who may not reach it. */
export class Links {
  readonly subjects = new Map<string, string>();
  readonly hidden = new Set<string>();
  /** The party each subject is about, where it is a person's. */
  readonly parties = new Map<string, string>();

  link(requestId: string, partyId?: string): string {
    const subjectId = randomUUID();
    this.subjects.set(requestId, subjectId);
    if (partyId !== undefined) this.parties.set(subjectId, partyId);
    return subjectId;
  }

  hide(actor: Actor, requestId: string): void {
    this.hidden.add(`${actor.id}:${requestId}`);
  }

  reach = (
    _tx: TenantTransaction,
    reader: Reader,
    requestIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> =>
    Promise.resolve(
      new Map(
        requestIds.flatMap((id) => {
          const subject = this.subjects.get(id);
          return subject === undefined || this.hidden.has(`${reader.membershipId}:${id}`)
            ? []
            : [[id, subject] as const];
        }),
      ),
    );
}

export const kindOf = (definition: WorkflowDefinition, links: Links): ApprovalKind => ({
  definition,
  subjects: {
    reach: links.reach,
    partyId: (_tx, subjectId) => Promise.resolve(links.parties.get(subjectId) ?? null),
  },
});

export interface Published {
  readonly requestId: string;
  readonly outcome: string;
  readonly decidedAt: string;
  readonly by: string;
}

export function serviceFor(kinds: readonly ApprovalKind[]): {
  service: WorkflowService;
  published: Published[];
} {
  const published: Published[] = [];
  const publish: PublishDecided = (_tx, data, by) => {
    published.push({ ...data, by: by.membershipId });
    return Promise.resolve();
  };
  return { service: createWorkflowService(kinds, publish), published };
}

/** Store version 1 of each definition, and the later versions in `approvers`, as `author`. */
export function storeDefinition(
  tenant: TestTenant,
  author: Actor,
  definition: WorkflowDefinition,
  approvers: readonly number[] = [],
): Promise<string[]> {
  return committedAs(tenant.id, author, async (client) => {
    const stored = await insertRow(client, 'app.workflow_definition', {
      tenant_id: tenant.id,
      key: definition.key,
      created_by: author.id,
    });
    const ids: string[] = [];
    for (const [index, count] of [
      definition.approvalSteps[0]?.approvers ?? 1,
      ...approvers,
    ].entries()) {
      ids.push(
        await insertRow(client, 'app.workflow_definition_version', {
          tenant_id: tenant.id,
          definition_id: stored,
          version: index + 1,
          document: {
            ...definition,
            version: index + 1,
            approvalSteps: definition.approvalSteps.map((step) => ({ ...step, approvers: count })),
          },
          created_by: author.id,
        }),
      );
    }
    return ids;
  });
}

/** The audit writer for a transaction, as the policy builds it. */
export function auditFor(tx: TenantTransaction, actor: Actor): RequestAudit {
  const by = { kind: 'user', membershipId: actor.id, requestId: randomUUID() } as const;
  return {
    record: (event) => recordAudit(tx, by, event),
    read: (entity) => recordRead(tx, by, entity),
  };
}

/** The tenant transaction over a connection that is acting as the actor's session. */
const transactionOn = (client: unknown): TenantTransaction =>
  kyselyOn(client as Parameters<typeof kyselyOn>[0]) as unknown as TenantTransaction;

/**
 * Runs `work` in one transaction as `actor`'s session and commits it, with
 * the service bound to it. The member's permissions are read from their roles
 * in the transaction, as the policy reads them for each request.
 */
export function asActor<T>(
  service: WorkflowService,
  actor: Actor,
  work: (workflow: RequestWorkflow, tx: TenantTransaction) => Promise<T>,
  options: { recentAuthAt?: Date | null } = {},
): Promise<T> {
  return committedAs(actor.tenant.id, actor, async (client) => {
    const tx = transactionOn(client);
    const { rows } = await client.query<{ roles: string[] }>(
      'SELECT roles FROM app.membership WHERE id = $1',
      [actor.id],
    );
    const workflow = service({
      tx,
      session: {
        userId: actor.userId,
        recentAuthAt: 'recentAuthAt' in options ? (options.recentAuthAt ?? null) : new Date(),
      },
      membership: {
        id: actor.id,
        permissions: new Set(permissionsFor(rows[0]?.roles ?? [], 'console')),
      },
      audit: auditFor(tx, actor),
      requestId: randomUUID(),
    });
    return work(workflow, tx);
  });
}

/**
 * An `inTenant` for the API under test whose transaction acts as the member
 * `current()` names, since the stand-in sessions of the route tests are not
 * rows in `auth.session`.
 */
export function inTenantAs(current: () => Actor | undefined): InTenant {
  return (tenant, work) => {
    const actor = current();
    if (actor === undefined || actor.tenant.id !== tenant) {
      throw new Error('The test has no member acting in this tenant.');
    }
    return committedAs(tenant, actor, (client) => work(transactionOn(client)));
  };
}
