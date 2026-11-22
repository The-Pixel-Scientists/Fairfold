// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Workflow definitions (ADR 0038): a module's named workflow, its states, the
// transitions between them and the approval steps a transition may need
// first. Modules ship them in their contracts; each tenant stores numbered
// versions of them as configuration (rule 10), and a tenant's version may
// only raise approver counts and change reminder days. A definition holds no
// tenant, actor, membership or free text, and nothing in it can act on a
// timer: reminder and due days only remind and flag (rule 9).

import { z } from 'zod';

import { permissions, permissionSchema, type Permission } from '../platform/access.ts';
import { moduleIds } from '../platform/modules.ts';

/** The most distinct approvers one step can need. */
export const MAX_APPROVERS = 5;

/** The entity type each stored version records in `app.config_version`, with the definition's id. */
export const workflowConfigEntityType = 'platform.workflow_definition';

/** `<module>.<name>`, such as `finance.payment_run`, for a known module. */
export const workflowKeySchema = z.string().regex(/^[a-z]+\.[a-z][a-z_]{0,62}$/);

/** A state's stable id: snake_case, or the uuid of the row it is derived from, such as a grants stage. */
export const stateIdSchema = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_]{0,62}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);

/** An approval step's stable id, snake_case. */
export const stepIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

/** Words on a screen: no surrounding space and no control characters. */
const labelSchema = z
  .string()
  .max(100)
  .regex(/^[^\p{Cc}\s](?:[^\p{Cc}]*[^\p{Cc}\s])?$/u);

const daysSchema = z.int().min(1).max(365);

const stateSchema = z.strictObject({
  id: stateIdSchema,
  label: labelSchema,
  /** No transition may leave it. */
  terminal: z.literal(true).optional(),
});

const transitionSchema = z.strictObject({
  from: stateIdSchema,
  to: stateIdSchema,
  /** What happens, in sentence case: "Approve payment". */
  label: labelSchema,
  /** The console permission of the definition's module that the member making it must hold. */
  permission: permissionSchema,
  /** The approval step whose request must be approved first. */
  approval: stepIdSchema.optional(),
});

const approvalStepSchema = z.strictObject({
  id: stepIdSchema,
  label: labelSchema,
  /** The decide buttons: "Approve payment", "Reject payment". */
  approveLabel: labelSchema,
  rejectLabel: labelSchema,
  /** Held by each approver, as well as `platform.approvals.decide`. */
  permission: permissionSchema,
  /** How many distinct members must approve. */
  approvers: z.int().min(1).max(MAX_APPROVERS),
  /** Marks a step where money moves (ADR 0041). Every decision needs step-up regardless. */
  movesMoney: z.boolean(),
  /** Remind those who may decide once a request has waited this long. */
  remindAfterDays: daysSchema.optional(),
  /** Flag a request as overdue after this long. It stays pending. */
  dueAfterDays: daysSchema.optional(),
});

const definitionShape = z.strictObject({
  key: workflowKeySchema,
  /** This version's number in the tenant; a module ships version 1. */
  version: z.int().min(1),
  /** Whether reading a request is a sensitive read of its subject, audited as `platform.approval.viewed`. */
  sensitiveRead: z.boolean(),
  states: z.array(stateSchema).min(1).max(50),
  initial: stateIdSchema,
  transitions: z.array(transitionSchema).max(500),
  approvalSteps: z.array(approvalStepSchema).max(20),
});

export type WorkflowDefinition = z.output<typeof definitionShape>;
export type WorkflowState = WorkflowDefinition['states'][number];
export type WorkflowTransition = WorkflowDefinition['transitions'][number];
export type ApprovalStep = WorkflowDefinition['approvalSteps'][number];

function duplicates(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

function permissionProblems(module: string, permission: Permission, where: string): string[] {
  if (!permission.startsWith(`${module}.`)) {
    return [`${where} needs ${permission}, of another module; use a ${module} permission.`];
  }
  if (permissions[permission].app !== 'console') {
    return [`${where} needs ${permission}, which is not a console permission; use one that is.`];
  }
  return [];
}

/** The states the initial state leads to, itself included. */
function reachable(definition: WorkflowDefinition): Set<string> {
  const seen = new Set([definition.initial]);
  for (const state of seen) {
    for (const { from, to } of definition.transitions) if (from === state) seen.add(to);
  }
  return seen;
}

/** Everything wrong with a definition's ids and graph, as sentences that say how to fix it. */
export function workflowDefinitionProblems(definition: WorkflowDefinition): string[] {
  const module = definition.key.split('.')[0] ?? '';
  const states = new Map(definition.states.map((state) => [state.id, state]));
  const steps = new Set(definition.approvalSteps.map((step) => step.id));
  const problems: string[] = [];
  if (!(moduleIds as readonly string[]).includes(module)) {
    problems.push(`The key ${definition.key} names no module; start it with a module id.`);
  }
  for (const id of duplicates(definition.states.map((state) => state.id))) {
    problems.push(`State ${id} is listed twice; give each state its own id.`);
  }
  for (const id of duplicates(definition.approvalSteps.map((step) => step.id))) {
    problems.push(`Approval step ${id} is listed twice; give each step its own id.`);
  }
  if (!states.has(definition.initial)) {
    problems.push(`The initial state ${definition.initial} is not listed; add it to states.`);
  }
  const pairs = definition.transitions.map(({ from, to }) => `${from} to ${to}`);
  for (const pair of duplicates(pairs)) {
    problems.push(`There are two transitions from ${pair}; keep one.`);
  }
  for (const transition of definition.transitions) {
    const { from, to, approval } = transition;
    const where = `The transition from ${from} to ${to}`;
    for (const id of [from, to]) {
      if (!states.has(id)) {
        problems.push(`${where} names the unknown state ${id}; add it or fix the id.`);
      }
    }
    if (from === to) problems.push(`${where} goes nowhere; remove it.`);
    if (states.get(from)?.terminal === true) {
      problems.push(`${where} leaves a terminal state; remove it or the terminal mark.`);
    }
    if (approval !== undefined && !steps.has(approval)) {
      problems.push(`${where} needs the unknown approval step ${approval}; add it or fix the id.`);
    }
    problems.push(...permissionProblems(module, transition.permission, where));
  }
  // A request names a step, never a transition, so each step gates exactly one.
  const used = definition.transitions.map((transition) => transition.approval);
  for (const step of definition.approvalSteps) {
    const uses = used.filter((id) => id === step.id).length;
    if (uses === 0) {
      problems.push(`No transition needs approval step ${step.id}; name it on one or remove it.`);
    }
    if (uses > 1) {
      problems.push(
        `Approval step ${step.id} is needed by more than one transition; give each transition its own step.`,
      );
    }
    problems.push(...permissionProblems(module, step.permission, `Approval step ${step.id}`));
  }
  const reached = reachable(definition);
  for (const state of definition.states) {
    if (!reached.has(state.id)) {
      problems.push(
        `No transition reaches ${state.id} from the initial state; add one or remove it.`,
      );
    }
  }
  return problems;
}

/** A definition as stored or shipped. Parsing refuses everything defineWorkflow() refuses. */
export const workflowDefinitionSchema = definitionShape.superRefine((definition, context) => {
  for (const message of workflowDefinitionProblems(definition)) {
    context.addIssue({ code: 'custom', message });
  }
});

/** Returns a module's shipped definition unchanged, or throws if it breaks a rule. */
export function defineWorkflow<const D extends z.input<typeof definitionShape>>(definition: D): D {
  const result = workflowDefinitionSchema.safeParse(definition);
  if (!result.success) {
    const problems = result.error.issues.map(({ path, message }) =>
      path.length === 0 ? message : `${path.join('.')}: ${message}`,
    );
    throw new Error(
      `Workflow ${definition.key} breaks the definition rules:\n- ${problems.join('\n- ')}`,
    );
  }
  return definition;
}

/** The parts a tenant may not change, in a form that compares as text. */
function fixedParts(definition: WorkflowDefinition): string {
  const parsed = workflowDefinitionSchema.parse(definition);
  const free = { approvers: null, remindAfterDays: null, dueAfterDays: null };
  return JSON.stringify({
    ...parsed,
    version: null,
    approvalSteps: parsed.approvalSteps.map((step) => ({ ...step, ...free })),
  });
}

/**
 * What is wrong with a tenant's version of a shipped definition, both
 * parsed. A version may raise approver counts and change reminder and due
 * days, and nothing else, so a tenant can tighten a control but never
 * remove or weaken one.
 */
export function tenantVersionProblems(
  shipped: WorkflowDefinition,
  version: WorkflowDefinition,
): string[] {
  const problems: string[] = [];
  for (const step of version.approvalSteps) {
    const minimum = shipped.approvalSteps.find(({ id }) => id === step.id)?.approvers ?? 1;
    if (step.approvers < minimum) {
      problems.push(
        `Approval step ${step.id} needs at least ${minimum} approvers; raise the count.`,
      );
    }
  }
  if (fixedParts(shipped) !== fixedParts(version)) {
    problems.push(
      'Only approver counts and reminder and due days can differ from the shipped definition; put the rest back.',
    );
  }
  return problems;
}
