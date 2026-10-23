// SPDX-License-Identifier: AGPL-3.0-or-later

import { roles } from '@pixel-scientists/domain/platform';
import type { Role } from '@pixel-scientists/domain/platform';
import type { CheckboxOption } from '@pixel-scientists/ui';

/** What each console role lets a person do, in a sentence. The permissions behind them stay in the domain package. */
const can: Partial<Record<Role, string>> = {
  tenant_admin: 'Manages the team and settings, exports data and reads the audit log.',
  programme_manager:
    'Sets up programmes and rounds, assigns reviewers, records decisions and releases them.',
  reviewer:
    'Scores the applications assigned to them. Reviews are blind, so they never see applicant names.',
};

/** The roles a team member can hold, in the order the domain package lists them. */
export const consoleRoles = (Object.keys(roles) as Role[]).filter(
  (role) => roles[role].app === 'console',
);

export const roleDescription = (role: Role): string => can[role] ?? '';

/** Checkboxes for choosing roles, each with what it allows. */
export const roleChoices: readonly CheckboxOption[] = consoleRoles.map((role) => ({
  value: role,
  label: (
    <>
      {roles[role].label}
      <span className="block text-sm text-muted">{roleDescription(role)}</span>
    </>
  ),
}));
