// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The workflow service a handler reaches as `context.workflow` (ADR 0038):
// ask for an approval, decide it, withdraw it and read where it stands, all in
// the request's own tenant transaction, so a module's change and its request
// commit or roll back together. The tenant is the transaction's and the actor
// the session's membership; nothing here takes either as an argument (rule 6).
//
// The domain package's functions decide who may do what, and the database
// triggers decide it again. A decision that settles a step closes the request
// in the deciding member's own call (rule 9); nothing here runs on a timer,
// and the module still makes its own named transition afterwards.

import { idSchema } from '@pixel-scientists/domain';
import { moduleOn, type ModuleId, type Permission } from '@pixel-scientists/domain/platform';
import {
  approvalsReceived,
  checkApprovalDecision,
  stepOutcome,
  tenantVersionProblems,
  workflowDefinitionSchema,
  type ApprovalDecision,
  type ApprovalPage,
  type ApprovalRequest,
  type ApprovalRequestDetail,
  type ApprovalStep,
  type DecisionState,
  type Member,
  type RequestState,
} from '@pixel-scientists/domain/workflow';
import { z } from 'zod';

import type { RequestAudit, RequestSession } from '../../context.ts';
import type { TenantTransaction } from '../../database.ts';
import { STEP_UP_WINDOW_MS } from '../../policy/index.ts';
import { ApiError } from '../../problems.ts';
import type { ApprovalKind, Reader } from './kinds.ts';
import { databaseRefusal, refusal, type Refusal } from './problems.ts';
import type { ApprovalTables } from './tables.ts';

/** Most requests on a page, and how many the inbox reads and filters at once. */
const PAGE_SIZE = 50;
const BATCH_SIZE = 100;
/** A page that finds too few it may show in this many batches gives its cursor back instead. */
const MAX_BATCHES = 5;

/** What the service needs of the request it serves. */
export interface WorkflowRequest {
  readonly tx: TenantTransaction;
  readonly session: Pick<RequestSession, 'userId' | 'recentAuthAt'>;
  readonly membership: { readonly id: string; readonly permissions: ReadonlySet<Permission> };
  readonly audit: RequestAudit;
  readonly requestId: string;
}

/** Publishes `platform.approval_decided.v1` in the transaction. */
export type PublishDecided = (
  tx: TenantTransaction,
  data: { requestId: string; outcome: 'approved' | 'rejected'; decidedAt: string },
  by: { requestId: string; membershipId: string },
) => Promise<void>;

export type Decision =
  | { readonly outcome: 'approve' }
  | {
      readonly outcome: 'reject';
      readonly reasonCode: NonNullable<ApprovalDecision['reasonCode']>;
    };

export type WithdrawalReason = Exclude<
  NonNullable<ApprovalRequest['closeReason']>,
  'requester_removed'
>;

export interface RequestWorkflow {
  /**
   * Asks for a step of a workflow the module ships, as the session's member,
   * and returns the request's id for the module's link table. A step the
   * module does not ship is the module's bug, so it throws a server error.
   */
  request(input: {
    definitionKey: string;
    stepId: string;
    /** The party the subject is about, where it is a person (ADR 0027). */
    subjectPartyId?: string;
  }): Promise<string>;
  /** Records the session member's decision, and closes the request if it settled the step. */
  decide(requestId: string, decision: Decision): Promise<ApprovalRequestDetail>;
  /** The requester's own withdrawal of a pending request. */
  withdraw(requestId: string, reasonCode: WithdrawalReason): Promise<ApprovalRequestDetail>;
  /** Where a request stands, if the member reaches its subject; a 404 otherwise. */
  state(requestId: string): Promise<ApprovalRequestDetail>;
  /** state(), and a `platform.approval.viewed` event where the definition makes reading sensitive. */
  read(requestId: string): Promise<ApprovalRequestDetail>;
  /** The pending requests the member may decide, or made, oldest first. */
  list(view: 'to_decide' | 'mine', cursor?: string): Promise<ApprovalPage>;
}

export type WorkflowService = (request: WorkflowRequest) => RequestWorkflow;

/** A request's `requested_at` as the database writes it, so a page boundary loses no microseconds. */
const cursorSchema = z.tuple([
  z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?[+-]\d\d(?::?\d\d)?$/),
  idSchema,
]);

type Cursor = z.infer<typeof cursorSchema>;

function readCursor(cursor: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new ApiError(400, 'The page marker is not valid. Start again from the first page.', {
      reason: 'bad_cursor',
    });
  }
}

const writeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

const moduleOf = (key: string): ModuleId => key.split('.')[0] as ModuleId;

interface RequestRow {
  readonly id: string;
  readonly definition_key: string;
  readonly definition_version_id: string;
  readonly step_id: string;
  readonly required_approvals: number;
  readonly status: ApprovalRequest['status'];
  readonly requested_by: string;
  readonly requested_at: Date;
  readonly due_at: Date | null;
  readonly closed_at: Date | null;
  readonly close_reason: ApprovalRequest['closeReason'];
}

interface DecisionRow {
  readonly request_id: string;
  readonly decided_by: string;
  readonly outcome: ApprovalDecision['outcome'];
  readonly reason_code: ApprovalDecision['reasonCode'];
  readonly decided_at: Date;
}

/** A request the member reaches, with what the checks need. */
interface Loaded {
  readonly row: RequestRow;
  readonly kind: ApprovalKind;
  readonly step: ApprovalStep;
  readonly subjectId: string;
  readonly decisions: readonly DecisionRow[];
}

const REQUEST_COLUMNS = [
  'id',
  'definition_key',
  'definition_version_id',
  'step_id',
  'required_approvals',
  'status',
  'requested_by',
  'requested_at',
  'due_at',
  'closed_at',
  'close_reason',
] as const;

const requestState = (row: RequestRow): RequestState => ({
  status: row.status,
  requestedBy: row.requested_by,
  requiredApprovals: row.required_approvals,
});

const decisionStates = (decisions: readonly DecisionRow[]): DecisionState[] =>
  decisions.map(({ decided_by, outcome }) => ({ decidedBy: decided_by, outcome }));

/** A decision on a step that is settled reads as one, and on a withdrawn request as a closed one. */
function refusedAs(reason: Refusal, status: RequestRow['status']): Refusal {
  return reason === 'request_closed' && status !== 'withdrawn' ? 'step_complete' : reason;
}

/** The service for the shipped workflows `kinds`, each checked once here. */
export function createWorkflowService(
  kinds: readonly ApprovalKind[],
  publishDecided: PublishDecided,
): WorkflowService {
  const byKey = new Map<string, ApprovalKind>();
  for (const kind of kinds) {
    const { key, version } = workflowDefinitionSchema.parse(kind.definition);
    if (version !== 1 || byKey.has(key)) {
      throw new Error(`Workflow ${key} must be shipped once, at version 1.`);
    }
    byKey.set(key, kind);
  }

  return ({ tx, session, membership, audit, requestId }) => {
    const db = tx.$extendTables<ApprovalTables>();
    const reader: Reader = { userId: session.userId, membershipId: membership.id };
    const member: Member = { membershipId: membership.id, permissions: membership.permissions };
    const stepOf = (key: string, stepId: string) =>
      byKey.get(key)?.definition.approvalSteps.find(({ id }) => id === stepId);

    /** The keys of the shipped workflows whose module is on for the tenant. */
    async function keysOn(): Promise<string[]> {
      const switches = await db
        .selectFrom('app.tenant_module')
        .select(['module', 'enabled'])
        .execute();
      const stored = new Map(switches.map(({ module, enabled }) => [module, enabled]));
      return [...byKey.keys()].filter((key) => moduleOn(moduleOf(key), stored.get(moduleOf(key))));
    }

    const decisionsOf = (ids: readonly string[]): Promise<DecisionRow[]> =>
      ids.length === 0
        ? Promise.resolve([])
        : db
            .selectFrom('app.approval_decision')
            .select(['request_id', 'decided_by', 'outcome', 'reason_code', 'decided_at'])
            .where('request_id', 'in', ids)
            .orderBy('decided_at')
            .orderBy('id')
            .execute();

    /**
     * The request, if it exists in this tenant, its workflow is shipped and
     * on, and the member reaches its subject. Anything else reads as missing.
     * With `lock`, the row stays locked until the transaction ends, so
     * decisions on it are taken one at a time.
     */
    async function load(id: string, lock = false): Promise<Loaded | undefined> {
      if (!idSchema.safeParse(id).success) return undefined;
      const query = db
        .selectFrom('app.approval_request')
        .select(REQUEST_COLUMNS)
        .where('id', '=', id);
      const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
      const kind = row && byKey.get(row.definition_key);
      const step = row && stepOf(row.definition_key, row.step_id);
      if (!row || !kind || !step || !(await keysOn()).includes(row.definition_key)) {
        return undefined;
      }
      const subjectId = (await kind.subjects.reach(tx, reader, [id])).get(id);
      if (subjectId === undefined) return undefined;
      return { row, kind, step, subjectId, decisions: await decisionsOf([id]) };
    }

    const loadOrThrow = async (id: string, lock = false): Promise<Loaded> =>
      (await load(id, lock)) ?? Promise.reject(refusal('not_found'));

    const summary = (row: RequestRow, subjectId: string, decisions: readonly DecisionRow[]) =>
      ({
        id: row.id,
        definitionKey: row.definition_key,
        definitionVersionId: row.definition_version_id,
        stepId: row.step_id,
        subjectId,
        status: row.status,
        requiredApprovals: row.required_approvals,
        approvals: approvalsReceived(requestState(row), decisionStates(decisions)),
        requestedBy: row.requested_by,
        requestedAt: row.requested_at.toISOString(),
        dueAt: row.due_at?.toISOString() ?? null,
        closedAt: row.closed_at?.toISOString() ?? null,
        closeReason: row.close_reason,
      }) satisfies ApprovalRequest;

    const detail = ({ row, step, subjectId, decisions }: Loaded): ApprovalRequestDetail => ({
      ...summary(row, subjectId, decisions),
      decisions: decisions.map((d) => ({
        decidedBy: d.decided_by,
        outcome: d.outcome,
        reasonCode: d.reason_code,
        decidedAt: d.decided_at.toISOString(),
      })),
      canDecide: checkApprovalDecision(step, requestState(row), decisionStates(decisions), member)
        .allowed,
      canWithdraw: row.status === 'pending' && row.requested_by === membership.id,
    });

    /** The party a subject is about, for the audit event, where its module says. */
    async function partyOf({ kind, subjectId }: Loaded): Promise<{ subjectPartyId?: string }> {
      const subjectPartyId = await kind.subjects.partyId?.(tx, subjectId);
      return subjectPartyId === undefined || subjectPartyId === null ? {} : { subjectPartyId };
    }

    /** Closes the request as the session's member; the database checks the closing again. */
    async function close(
      id: string,
      status: 'approved' | 'rejected' | 'withdrawn',
      closeReason: ApprovalRequest['closeReason'] = null,
    ): Promise<void> {
      try {
        await db
          .updateTable('app.approval_request')
          .set({ status, closed_by: membership.id, close_reason: closeReason })
          .where('id', '=', id)
          .where('status', '=', 'pending')
          .execute();
      } catch (error) {
        throw databaseRefusal(error) ?? error;
      }
    }

    /** The subjects of `rows` the member reaches, from each workflow's own link table. */
    async function reachedBy(rows: readonly RequestRow[]): Promise<Map<string, string>> {
      const reached = new Map<string, string>();
      for (const key of new Set(rows.map((row) => row.definition_key))) {
        const ids = rows.filter((row) => row.definition_key === key).map(({ id }) => id);
        const found = await byKey.get(key)?.subjects.reach(tx, reader, ids);
        for (const [id, subjectId] of found ?? []) reached.set(id, subjectId);
      }
      return reached;
    }

    return {
      async request({ definitionKey, stepId, subjectPartyId }) {
        const kind = byKey.get(definitionKey);
        const step = stepOf(definitionKey, stepId);
        if (!kind || !step) throw new Error('A module asked for a workflow step it does not ship.');
        if (!(await keysOn()).includes(definitionKey)) throw refusal('not_found');

        const version = await db
          .selectFrom('app.workflow_definition_version as v')
          .innerJoin('app.workflow_definition as d', (join) =>
            join.onRef('d.id', '=', 'v.definition_id').onRef('d.tenant_id', '=', 'v.tenant_id'),
          )
          .select(['v.id', 'v.document'])
          .where('d.key', '=', definitionKey)
          .orderBy('v.version', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (version === undefined) {
          throw new Error('The tenant has no stored version of a workflow its module ships.');
        }
        const stored = workflowDefinitionSchema.parse(version.document);
        if (tenantVersionProblems(kind.definition, stored).length > 0) {
          throw new Error('The stored version of a workflow breaks the rules for tenant versions.');
        }

        let created;
        try {
          created = await db
            .insertInto('app.approval_request')
            .values((eb) => ({
              tenant_id: eb.fn<string>('app.current_tenant_id', []),
              definition_version_id: version.id,
              step_id: step.id,
              requested_by: membership.id,
            }))
            .returning(['id', 'required_approvals'])
            .executeTakeFirstOrThrow();
        } catch (error) {
          throw databaseRefusal(error) ?? error;
        }
        await audit.record({
          action: 'platform.approval.requested',
          entityId: created.id,
          changes: {
            'app.approval_request.definition_version_id': { after: version.id },
            'app.approval_request.step_id': { after: step.id },
            'app.approval_request.required_approvals': { after: created.required_approvals },
          },
          ...(subjectPartyId === undefined ? {} : { subjectPartyId }),
        });
        return created.id;
      },

      async decide(id, decision) {
        const loaded = await loadOrThrow(id, true);
        const { row, step, decisions } = loaded;
        const checked = checkApprovalDecision(
          step,
          requestState(row),
          decisionStates(decisions),
          member,
        );
        if (!checked.allowed) throw refusal(refusedAs(checked.reason, row.status));
        const signedInAt = session.recentAuthAt?.getTime();
        const now = Date.now();
        if (signedInAt === undefined || now - signedInAt > STEP_UP_WINDOW_MS || signedInAt > now) {
          throw refusal('step_up');
        }

        let decidedAt: Date;
        try {
          ({ decided_at: decidedAt } = await db
            .insertInto('app.approval_decision')
            .values((eb) => ({
              tenant_id: eb.fn<string>('app.current_tenant_id', []),
              request_id: id,
              decided_by: membership.id,
              outcome: decision.outcome,
              reason_code: decision.outcome === 'reject' ? decision.reasonCode : null,
            }))
            .returning('decided_at')
            .executeTakeFirstOrThrow());
        } catch (error) {
          throw databaseRefusal(error) ?? error;
        }

        const settled = stepOutcome(requestState(row), [
          ...decisionStates(decisions),
          { decidedBy: membership.id, outcome: decision.outcome },
        ]);
        if (settled !== 'pending') await close(id, settled);
        await audit.record({
          action:
            decision.outcome === 'approve'
              ? 'platform.approval.approved'
              : 'platform.approval.rejected',
          entityId: id,
          changes: {
            'app.approval_decision.outcome': { after: decision.outcome },
            ...(decision.outcome === 'reject'
              ? { 'app.approval_decision.reason_code': { after: decision.reasonCode } }
              : {}),
            ...(settled === 'pending'
              ? {}
              : { 'app.approval_request.status': { before: 'pending', after: settled } }),
          },
          ...(await partyOf(loaded)),
        });
        if (settled !== 'pending') {
          await publishDecided(
            tx,
            { requestId: id, outcome: settled, decidedAt: decidedAt.toISOString() },
            { requestId, membershipId: membership.id },
          );
        }
        return detail(await loadOrThrow(id));
      },

      async withdraw(id, reasonCode) {
        const loaded = await loadOrThrow(id, true);
        if (loaded.row.requested_by !== membership.id) throw refusal('not_requester');
        if (loaded.row.status !== 'pending') throw refusal('request_closed');
        await close(id, 'withdrawn', reasonCode);
        await audit.record({
          action: 'platform.approval.withdrawn',
          entityId: id,
          changes: {
            'app.approval_request.status': { before: 'pending', after: 'withdrawn' },
            'app.approval_request.close_reason': { after: reasonCode },
          },
          ...(await partyOf(loaded)),
        });
        return detail(await loadOrThrow(id));
      },

      state: async (id) => detail(await loadOrThrow(id)),

      async read(id) {
        const loaded = await loadOrThrow(id);
        if (loaded.kind.definition.sensitiveRead) {
          await audit.read({
            action: 'platform.approval.viewed',
            entityId: id,
            ...(await partyOf(loaded)),
          });
        }
        return detail(loaded);
      },

      async list(view, cursor) {
        const keys = await keysOn();
        if (keys.length === 0) return { requests: [], nextCursor: null };
        let scanned = cursor === undefined ? undefined : readCursor(cursor);
        const requests: ApprovalRequest[] = [];
        for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
          let query = db
            .selectFrom('app.approval_request')
            .select(REQUEST_COLUMNS)
            .select((eb) => eb.cast<string>('requested_at', 'text').as('cursor_at'))
            .where('status', '=', 'pending')
            .where('definition_key', 'in', keys)
            .where('requested_by', view === 'mine' ? '=' : '<>', membership.id)
            .orderBy('requested_at')
            .orderBy('id')
            .limit(BATCH_SIZE);
          if (scanned !== undefined) {
            const [at, id] = scanned;
            query = query.where((eb) => {
              const from = eb.cast<Date>(eb.val(at), 'timestamptz');
              return eb.or([
                eb('requested_at', '>', from),
                eb.and([eb('requested_at', '=', from), eb('id', '>', id)]),
              ]);
            });
          }
          const rows = await query.execute();
          const reached = await reachedBy(rows);
          const decisions = await decisionsOf(rows.map(({ id }) => id));
          for (const { cursor_at, ...row } of rows) {
            scanned = [cursor_at, row.id];
            const subjectId = reached.get(row.id);
            const step = stepOf(row.definition_key, row.step_id);
            const own = decisions.filter(({ request_id }) => request_id === row.id);
            const shown =
              subjectId !== undefined &&
              step !== undefined &&
              (view === 'mine' ||
                checkApprovalDecision(step, requestState(row), decisionStates(own), member)
                  .allowed);
            if (shown) requests.push(summary(row, subjectId, own));
            if (requests.length === PAGE_SIZE)
              return { requests, nextCursor: writeCursor(scanned) };
          }
          if (rows.length < BATCH_SIZE) return { requests, nextCursor: null };
        }
        return { requests, nextCursor: scanned === undefined ? null : writeCursor(scanned) };
      },
    };
  };
}
