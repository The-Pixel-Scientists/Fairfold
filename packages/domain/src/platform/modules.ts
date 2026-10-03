// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The suite's modules (ADR 0016). Each owns its schemas. Only a switchable
// module can be turned off for a tenant, and a switch never sells access.

import { z } from 'zod';

export const moduleIds = ['platform', 'party', 'grants'] as const;

export type ModuleId = (typeof moduleIds)[number];

export const moduleSchema = z.enum(moduleIds);

export const modules = {
  platform: { label: 'Platform', schemas: ['app', 'auth'], switchable: false },
  party: { label: 'Organisations and people', schemas: ['party'], switchable: false },
  grants: { label: 'Grants', schemas: ['grants'], switchable: true },
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
