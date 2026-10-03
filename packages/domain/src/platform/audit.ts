// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Audit action codes (architecture rule 4, ADR 0016). Each module keeps a
// closed list of `<module>.<entity>.<event>` codes, such as
// `grants.decision.released`; the entity type is the code without its event.
// The audit writer accepts only codes for which isAuditAction() is true:
// those in a list defined once the modules' contracts have loaded.

import { authEventCodes } from '../auth/events.ts';
import type { ModuleId } from './modules.ts';

export type AuditAction<M extends ModuleId = ModuleId> = `${M}.${string}.${string}`;

/** The same pattern as the check on `app.audit_event.action`. */
export const auditActionPattern = /^[a-z]+\.[a-z][a-z_]*\.[a-z][a-z_]*$/;

/** Each defined code, with the list that defined it. */
const definedBy = new Map<string, string>();

/** Whether a code is in a defined list, for the audit writer. */
export function isAuditAction(code: string): boolean {
  return definedBy.has(code);
}

/**
 * A module's closed list. Refuses a code in the wrong form, for another
 * module, listed twice, or already defined by a different list. Defining the
 * same list again is allowed, since development servers re-run a module
 * when they reload it; after editing a list, reload the page.
 */
export function defineAuditActions<
  const M extends ModuleId,
  const A extends readonly AuditAction<M>[],
>(module: M, actions: A): A {
  for (const action of actions) {
    if (!auditActionPattern.test(action) || !action.startsWith(`${module}.`)) {
      throw new Error(`Audit action ${action} must be ${module}.<entity>.<event> in lower case.`);
    }
  }
  if (new Set(actions).size !== actions.length) {
    throw new Error(`The ${module} audit actions list a code twice.`);
  }
  const list = actions.join();
  for (const action of actions) {
    const owner = definedBy.get(action);
    if (owner !== undefined && owner !== list) {
      throw new Error(`Audit action ${action} is already defined by another list.`);
    }
  }
  for (const action of actions) definedBy.set(action, list);
  return actions;
}

/** `platform.membership.suspended` is about a `platform.membership`. */
export function auditEntityType(action: AuditAction): string {
  return action.slice(0, action.lastIndexOf('.'));
}

export const platformAuditActions = defineAuditActions('platform', [
  'platform.tenant.created',
  'platform.tenant.updated',
  'platform.theme.changed',
  'platform.module.switched_on',
  'platform.module.switched_off',
  'platform.invitation.sent',
  'platform.invitation.revoked',
  'platform.membership.created',
  'platform.membership.roles_changed',
  'platform.membership.suspended',
  'platform.membership.reinstated',
  'platform.membership.removed',
  'platform.warehouse.exported',
  // A tenant's copy of an auth event (ADR 0010), whose entity id is the auth event's id.
  // Accepting an invitation is one of them: `platform.auth.invitation_accepted`.
  ...authEventCodes.map((code) => `platform.auth.${code}` as const),
]);

export type PlatformAuditAction = (typeof platformAuditActions)[number];
