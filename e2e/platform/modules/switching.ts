// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Switching a tenant's modules through the administrator's own route
// (PATCH /console/settings/modules), with the step-up it may ask for, and
// reading back what the switch left in the session and the audit log.

import { switchableModuleIds } from '../../../packages/domain/src/platform/modules.ts';
import { auditEvents } from '../../support/audit.ts';
import { expect } from '../../support/test.ts';
import { stepUp, type Api } from '../../support/api.ts';
import { fixture } from './routes.ts';

interface ModuleList {
  modules: { module: string; enabled: boolean }[];
}

interface SessionAnswer {
  activeMembership: { id: string } | null;
  permissions: string[];
  modules?: string[];
}

export async function moduleStates(admin: Api): Promise<Map<string, boolean>> {
  const { modules } = await admin.ok<ModuleList>('GET', '/console/settings/modules');
  return new Map(modules.map(({ module, enabled }) => [module, enabled]));
}

export const readSession = (api: Api): Promise<SessionAnswer> =>
  api.ok<SessionAnswer>('GET', '/auth/session');

async function patch(admin: Api, module: string, enabled: boolean) {
  return admin.send('PATCH', '/console/settings/modules', { json: { module, enabled } });
}

/**
 * Switches a module to the state asked for, confirming the administrator
 * again if the route asks, and checks that a real change wrote one audit
 * event with the administrator as actor. Returns whether anything changed.
 */
export async function switchTo(
  admin: Api,
  accountName: string,
  module: string,
  enabled: boolean,
): Promise<boolean> {
  if ((await moduleStates(admin)).get(module) === enabled) return false;
  const action = enabled ? 'platform.module.switched_on' : 'platform.module.switched_off';
  const before = (await auditEvents(admin, { action })).length;
  let answer = await patch(admin, module, enabled);
  if (answer.status === 403) {
    await stepUp(admin, accountName);
    answer = await patch(admin, module, enabled);
  }
  expect(answer.status, `Switching ${module} answered ${answer.text.slice(0, 200)}`).toBe(200);

  const events = await auditEvents(admin, { action });
  expect(events.length - before, `${action} events for ${module}`).toBe(1);
  const { activeMembership } = await readSession(admin);
  const event = events.find(({ changes }) => changes['app.tenant_module.module']?.after === module);
  expect(event?.actor.membershipId, `${action} actor for ${module}`).toBe(activeMembership?.id);
  expect(event?.changes['app.tenant_module.enabled']?.after).toBe(enabled);
  return true;
}

/** Puts every switchable module back to the state the seed gave it. */
export async function restoreSeeded(admin: Api, accountName: string): Promise<void> {
  for (const module of switchableModuleIds) {
    await switchTo(admin, accountName, module, fixture.modulesOnAtSeed.includes(module));
  }
}
