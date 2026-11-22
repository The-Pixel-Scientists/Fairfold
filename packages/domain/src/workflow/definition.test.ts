// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  defineWorkflow,
  tenantVersionProblems,
  workflowConfigEntityType,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from './definition.ts';

const STAGE = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';

function payment() {
  return {
    key: 'grants.award_payment',
    version: 1,
    sensitiveRead: false,
    states: [
      { id: 'draft', label: 'Draft' },
      { id: 'awaiting_approval', label: 'Awaiting approval' },
      { id: 'approved', label: 'Approved' },
      { id: 'paid', label: 'Paid', terminal: true as const },
      { id: 'cancelled', label: 'Cancelled', terminal: true as const },
    ],
    initial: 'draft',
    transitions: [
      {
        from: 'draft',
        to: 'awaiting_approval',
        label: 'Ask for approval',
        permission: 'grants.decisions.record' as const,
      },
      {
        from: 'awaiting_approval',
        to: 'approved',
        label: 'Approve payment',
        permission: 'grants.decisions.record' as const,
        approval: 'payment',
      },
      {
        from: 'approved',
        to: 'paid',
        label: 'Mark as paid',
        permission: 'grants.decisions.record' as const,
      },
      {
        from: 'awaiting_approval',
        to: 'cancelled',
        label: 'Cancel payment',
        permission: 'grants.decisions.record' as const,
      },
    ],
    approvalSteps: [
      {
        id: 'payment',
        label: 'Payment approval',
        approveLabel: 'Approve payment',
        rejectLabel: 'Reject payment',
        permission: 'grants.decisions.release' as const,
        approvers: 2,
        movesMoney: true,
        remindAfterDays: 2,
        dueAfterDays: 5,
      },
    ],
  };
}

type Draft = ReturnType<typeof payment>;

function item<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`No item ${index}.`);
  return found;
}

function problemsOf(change: (draft: Draft) => unknown): string[] {
  const draft = payment();
  const changed = change(draft) ?? draft;
  const result = workflowDefinitionSchema.safeParse(changed);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('workflow definitions', () => {
  it('accept a definition with an approval step, and return it unchanged', () => {
    const definition = payment();
    expect(defineWorkflow(definition)).toBe(definition);
    expect(workflowDefinitionSchema.parse(definition)).toEqual(definition);
  });

  it('accept states derived from rows, by uuid, and need no terminal state', () => {
    const stages = () =>
      defineWorkflow({
        key: 'grants.round_stages',
        version: 1,
        sensitiveRead: false,
        states: [
          { id: STAGE, label: 'Submitted' },
          { id: 'shortlisted', label: 'Shortlisted' },
        ],
        initial: STAGE,
        transitions: [
          {
            from: STAGE,
            to: 'shortlisted',
            label: 'Move to Shortlisted',
            permission: 'grants.applications.triage',
          },
          {
            from: 'shortlisted',
            to: STAGE,
            label: 'Move to Submitted',
            permission: 'grants.applications.triage',
          },
        ],
        approvalSteps: [],
      });
    expect(stages).not.toThrow();
  });

  it('record each version in config_version as a platform entity', () => {
    expect(workflowConfigEntityType).toBe('platform.workflow_definition');
  });

  it.each<[string, (draft: Draft) => unknown, string]>([
    [
      'an unknown state',
      (d) => void (item(d.transitions, 0).to = 'nowhere'),
      'The transition from draft to nowhere names the unknown state nowhere; add it or fix the id.',
    ],
    [
      'a duplicate state',
      (d) => void d.states.push({ id: 'draft', label: 'Draft again' }),
      'State draft is listed twice; give each state its own id.',
    ],
    [
      'a duplicate step',
      (d) => void d.approvalSteps.push({ ...item(d.approvalSteps, 0) }),
      'Approval step payment is listed twice; give each step its own id.',
    ],
    [
      'a duplicate transition',
      (d) => void d.transitions.push({ ...item(d.transitions, 0), label: 'Ask again' }),
      'There are two transitions from draft to awaiting_approval; keep one.',
    ],
    [
      'a transition from a terminal state',
      (d) =>
        void d.transitions.push({
          from: 'paid',
          to: 'draft',
          label: 'Reopen payment',
          permission: 'grants.decisions.record',
        }),
      'The transition from paid to draft leaves a terminal state; remove it or the terminal mark.',
    ],
    [
      'a transition to itself',
      (d) => void d.transitions.push({ ...item(d.transitions, 2), to: 'approved' }),
      'The transition from approved to approved goes nowhere; remove it.',
    ],
    [
      'a state no transition reaches',
      (d) => void d.states.push({ id: 'archived', label: 'Archived' }),
      'No transition reaches archived from the initial state; add one or remove it.',
    ],
    [
      'an initial state that is not listed',
      (d) => void (d.initial = 'start'),
      'The initial state start is not listed; add it to states.',
    ],
    [
      'a key for no module',
      (d) => void (d.key = 'ledger.payment_run'),
      'The key ledger.payment_run names no module; start it with a module id.',
    ],
    [
      "a transition under another module's permission",
      (d) => void (item(d.transitions, 0).permission = 'crm.records.manage' as never),
      'The transition from draft to awaiting_approval needs crm.records.manage, of another module; use a grants permission.',
    ],
    [
      'a step under a portal permission',
      (d) => void (item(d.approvalSteps, 0).permission = 'grants.applications.apply' as never),
      'Approval step payment needs grants.applications.apply, which is not a console permission; use one that is.',
    ],
    [
      'an unknown approval step',
      (d) => void (item(d.transitions, 1).approval = 'budget'),
      'The transition from awaiting_approval to approved needs the unknown approval step budget; add it or fix the id.',
    ],
    [
      'a step no transition needs',
      (d) => {
        delete (item(d.transitions, 1) as { approval?: string }).approval;
      },
      'No transition needs approval step payment; name it on one or remove it.',
    ],
    [
      'a step needed by two transitions',
      (d) => void (item(d.transitions, 3).approval = 'payment'),
      'Approval step payment is needed by more than one transition; give each transition its own step.',
    ],
  ])('refuse %s, saying how to fix it', (_name, change, message) => {
    expect(problemsOf(change)).toContain(message);
    const draft = payment();
    change(draft);
    expect(() => defineWorkflow(draft)).toThrow(message);
  });

  it.each([0, 6, 1.5])('refuse %s approvers: from 1 to 5', (approvers) => {
    expect(problemsOf((d) => void (item(d.approvalSteps, 0).approvers = approvers))).toHaveLength(
      1,
    );
  });

  it('refuse any timer that names a transition or acts: timers only remind', () => {
    expect(
      problemsOf((d) => ({ ...d, approvalSteps: [{ ...d.approvalSteps[0], onDue: 'cancelled' }] })),
    ).not.toEqual([]);
    expect(
      problemsOf((d) => ({
        ...d,
        transitions: [{ ...d.transitions[0], afterDays: 3 }, ...d.transitions.slice(1)],
      })),
    ).not.toEqual([]);
    expect(problemsOf((d) => void (item(d.approvalSteps, 0).dueAfterDays = 0))).not.toEqual([]);
  });

  it.each(['tenantId', 'createdBy', 'requestedBy', 'membershipId', 'reason'])(
    'hold no %s, nor any key they do not name',
    (key) => {
      expect(problemsOf((d) => ({ ...d, [key]: STAGE }))).not.toEqual([]);
    },
  );

  it.each(['', ' Draft', 'Draft ', 'Dr\u0007aft', 'x'.repeat(101)])(
    'refuse the label %j',
    (label) => {
      expect(problemsOf((d) => void (item(d.states, 0).label = label))).not.toEqual([]);
    },
  );
});

describe('a tenant version of a shipped definition', () => {
  const shipped = workflowDefinitionSchema.parse(payment());
  const version = (change: (draft: Draft) => void): WorkflowDefinition => {
    const draft = payment();
    draft.version = 2;
    change(draft);
    return workflowDefinitionSchema.parse(draft);
  };

  it('may raise approver counts and change reminder and due days', () => {
    const raised = version((d) => {
      item(d.approvalSteps, 0).approvers = 3;
      item(d.approvalSteps, 0).remindAfterDays = 1;
      item(d.approvalSteps, 0).dueAfterDays = 10;
    });
    expect(tenantVersionProblems(shipped, raised)).toEqual([]);
  });

  it('may not lower a count', () => {
    expect(
      tenantVersionProblems(
        shipped,
        version((d) => void (item(d.approvalSteps, 0).approvers = 1)),
      ),
    ).toEqual(['Approval step payment needs at least 2 approvers; raise the count.']);
  });

  it.each<[string, (draft: Draft) => void]>([
    ['a label', (d) => void (item(d.approvalSteps, 0).label = 'Sign-off')],
    [
      'a permission',
      (d) => void (item(d.approvalSteps, 0).permission = 'grants.decisions.record' as never),
    ],
    ['money', (d) => void (item(d.approvalSteps, 0).movesMoney = false)],
    [
      'the approval on a transition',
      (d) => {
        delete (item(d.transitions, 1) as { approval?: string }).approval;
      },
    ],
    ['sensitive reads', (d) => void (d.sensitiveRead = true)],
  ])('may not change %s', (_name, change) => {
    const changed = payment();
    changed.version = 2;
    change(changed);
    const parsed = workflowDefinitionSchema.safeParse(changed);
    const problems = parsed.success ? tenantVersionProblems(shipped, parsed.data) : ['refused'];
    expect(problems).not.toEqual([]);
  });
});
