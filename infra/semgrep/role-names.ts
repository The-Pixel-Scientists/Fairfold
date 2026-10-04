// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for role-names.yaml, checked by `semgrep --test infra/semgrep`.

declare const member: { role: string; roles: string[] };
declare const memberRoles: Set<string>;
declare const audience: string;
declare const field: { audiences: string[] };

// ruleid: tps-no-role-name-checks
export const isAdmin = member.role === 'tenant_admin';

// ruleid: tps-no-role-name-checks
export const isManager = 'programme_manager' !== member.role;

// ruleid: tps-no-role-name-checks
export const listed = member.roles.includes('programme_manager');

// ruleid: tps-no-role-name-checks
export const held = memberRoles.has('reviewer');

// ruleid: tps-no-role-name-checks
export const applicantRole = member.role == 'applicant';

export function label(role: string): string {
  // ruleid: tps-no-role-name-checks
  switch (role) {
    case 'tenant_admin':
      return 'Administrator';
    default:
      return role;
  }
}

// ok: tps-no-role-name-checks
export const forApplicant = audience === 'applicant';

// ok: tps-no-role-name-checks
export const seenByReviewers = field.audiences.includes('reviewer');

// ok: tps-no-role-name-checks
export const named = member.role === 'owner';
