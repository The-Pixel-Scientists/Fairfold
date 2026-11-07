// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The suite's modules (ADR 0016). Each owns its schemas. The platform and
// party are always on; moduleOn() says whether a switchable module is on for
// a tenant (ADR 0024), and a switch never sells access.

import { z } from 'zod';

import { toolNames } from './brand.ts';

export const moduleIds = [
  'platform',
  'party',
  'grants',
  'crm',
  'assure',
  'forms',
  'privacy',
  'insight',
] as const;

export type ModuleId = (typeof moduleIds)[number];

export const moduleSchema = z.enum(moduleIds);

export const modules = {
  platform: { label: 'Platform', schemas: ['app', 'auth'], switchable: false },
  party: { label: 'Organisations and people', schemas: ['party'], switchable: false },
  grants: { label: toolNames.grants, schemas: ['grants'], switchable: true },
  crm: { label: toolNames.crm, schemas: ['crm'], switchable: true },
  assure: { label: toolNames.assure, schemas: ['assure'], switchable: true },
  forms: { label: toolNames.forms, schemas: ['forms'], switchable: true },
  privacy: { label: toolNames.privacy, schemas: ['privacy'], switchable: true },
  insight: { label: toolNames.insight, schemas: ['insight'], switchable: true },
} as const satisfies Record<
  ModuleId,
  { label: string; schemas: readonly string[]; switchable: boolean }
>;

export type SwitchableModuleId = {
  [M in ModuleId]: (typeof modules)[M]['switchable'] extends true ? M : never;
}[ModuleId];

/** The values of `app.tenant_module.module`. */
export const switchableModuleIds = moduleIds.filter(
  (id): id is SwitchableModuleId => modules[id].switchable,
);

/**
 * Whether a module is on for a tenant, given its stored switch
 * (`app.tenant_module.enabled`, undefined where the tenant has no row). The
 * platform and party are always on. No tool is on without a row (ADR 0024).
 */
export function moduleOn(module: ModuleId, stored: boolean | undefined): boolean {
  if (!modules[module].switchable) return true;
  return stored === true;
}
