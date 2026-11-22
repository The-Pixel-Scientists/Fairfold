// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round's stages as a workflow (ADR 0038, "Grants refit"). The stages stay
// grants' own configuration, versioned with the programme (rule 10); the
// definition is built from them when it is asked for and is never stored.
// Its first stage is where a submission starts, and a member holding
// `grants.applications.triage` may move a submission from any stage to any
// other, with no approval step. The engine only answers; the callers write
// the stage, the transition and the audit event for a move a named member
// asked for (rule 9).

import type { Permission } from '@pixel-scientists/domain/platform';
import {
  canTransition,
  defineWorkflow,
  type WorkflowDefinition,
} from '@pixel-scientists/domain/workflow';

import type { Tx } from '../programme/tables.ts';
import { submissionsDb } from './tables.ts';

const moveStages: Permission = 'grants.applications.triage';

interface StageRow {
  readonly id: string;
  readonly name: string;
}

/** The workflow of stages given in position order, or `undefined` for none. */
export function stageFlow(stages: readonly StageRow[]): WorkflowDefinition | undefined {
  const [first] = stages;
  if (first === undefined) return undefined;
  return defineWorkflow({
    key: 'grants.stage_flow',
    version: 1,
    sensitiveRead: false,
    states: stages.map(({ id, name }) => ({ id, label: name })),
    initial: first.id,
    transitions: stages.flatMap((from) =>
      stages
        .filter((to) => to.id !== from.id)
        .map((to) => ({
          from: from.id,
          to: to.id,
          label: `Move to ${to.name}`,
          permission: moveStages,
        })),
    ),
    approvalSteps: [],
  });
}

/** The round's stage workflow, or `undefined` for a round with no stages. */
export async function stageWorkflow(
  tx: Tx,
  roundId: string,
): Promise<WorkflowDefinition | undefined> {
  const stages = await submissionsDb(tx)
    .selectFrom('grants.stage')
    .select(['id', 'name'])
    .where('round_id', '=', roundId)
    .orderBy('position')
    .execute();
  return stageFlow(stages);
}

/** Whether the member may move a submission from one stage of the workflow to another. */
export function mayMove(
  workflow: WorkflowDefinition,
  from: string,
  to: string,
  member: { readonly id: string; readonly permissions: ReadonlySet<Permission> },
): boolean {
  return canTransition(workflow, from, to, {
    membershipId: member.id,
    permissions: member.permissions,
  }).allowed;
}
