// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where the stack is, and who the seed's `base` scenario made. Every address
// and password here is synthetic; the seed password is read from the file the
// stack keeps it in, and is never printed.

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { currentDevNames } from '../../scripts/dev-names.ts';
import { base } from '../../packages/db/seed/base.ts';
import { emailOf } from '../../packages/db/seed/scenario.ts';

const { ports, stackProject } = currentDevNames();

export const consoleOrigin = `http://console.localhost:${String(ports.stackConsole)}`;
export const portalOrigin =
  process.env['TPS_E2E_PORTAL_URL'] ?? `http://portal.localhost:${String(ports.stackPortal)}`;
export const mailpitOrigin =
  process.env['TPS_MAILPIT_URL'] ?? `http://127.0.0.1:${String(ports.stackMail)}`;

/** Where the steps of one run leave what the next steps need. */
export const stateFile = join(tmpdir(), 'tps-journey', `${stackProject}.json`);

/** The journey needs a stack seeded with `base`; it is opt-in because the other specs need other seeds. */
export const journeyEnabled =
  process.env['TPS_E2E_STACK'] === '1' && process.env['TPS_E2E_DEMO'] === '1';

export const journeySkipReason =
  'The demo journey runs on a stack seeded with `base`: pnpm stack seed base, then TPS_E2E_DEMO=1 pnpm test:stack --project journey --workers 1.';

let password: string | undefined;

/** The password of every seeded account. */
export function seedPassword(): string {
  const file = process.env['TPS_SEED_PASSWORD_FILE'];
  if (file === undefined) throw new Error('TPS_SEED_PASSWORD_FILE names the stack seed password.');
  password ??= readFileSync(file, 'utf8').trim();
  return password;
}

export type Slug = 'northfield' | 'eastmoor';
export type StaffRole = 'tenant_admin' | 'programme_manager' | 'reviewer';

/** The seeded staff of a tenant in one role, in the order the scenario lists them. */
export function staffEmails(slug: Slug, role: StaffRole): string[] {
  const tenant = base.find((candidate) => candidate.slug === slug);
  if (tenant === undefined) throw new Error(`The base scenario has no ${slug}.`);
  return tenant.staff.filter(([, , has]) => has === role).map((member) => emailOf(tenant, member));
}
