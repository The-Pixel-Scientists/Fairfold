// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { permissions, type Permission } from './access.ts';
import { permissionsFor, roles, type Role } from './roles.ts';

const roleIds = Object.keys(roles) as Role[];
const permissionIds = Object.keys(permissions) as Permission[];

describe('role map', () => {
  it('matches the reviewed snapshot of permissions and roles', async () => {
    const permissionLines = permissionIds.map((id) => {
      const permission = permissions[id];
      const stepUp = 'stepUp' in permission ? ', step-up for changes' : '';
      return `${id} (${permission.app}; ${permission.scopes.join(', ')}${stepUp})`;
    });
    const roleLines = roleIds.map((id) => {
      const role = roles[id];
      const granted = role.permissions.map((p) => `  ${p}`).join('\n');
      return `${id} (${role.app}, "${role.label}"):\n${granted}`;
    });
    const text = `Permissions:\n${permissionLines.join('\n')}\n\n${roleLines.join('\n\n')}\n`;
    await expect(text).toMatchFileSnapshot('./__snapshots__/access.txt');
  });

  it('gives each role only permissions of its own app, once each', () => {
    for (const id of roleIds) {
      const role = roles[id];
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      for (const permission of role.permissions) expect(permissions[permission].app).toBe(role.app);
    }
  });

  it('grants every permission to some role', () => {
    const granted = new Set(roleIds.flatMap((id) => roles[id].permissions));
    expect(permissionIds.filter((p) => !granted.has(p))).toEqual([]);
  });
});

describe('permissionsFor', () => {
  it('joins the permissions of a membership roles in one app', () => {
    expect(permissionsFor(['reviewer', 'programme_manager'], 'console')).toEqual(
      expect.arrayContaining(['grants.reviews.score', 'grants.decisions.release']),
    );
  });

  it('gives a portal session no staff permission, and the other way round', () => {
    expect(permissionsFor(['tenant_admin', 'applicant'], 'portal')).toEqual([
      'party.profile.manage',
      'grants.applications.apply',
    ]);
    expect(permissionsFor(['applicant'], 'console')).toEqual([]);
  });

  it('gives nothing for names that are not roles', () => {
    for (const name of ['owner', 'toString', '__proto__', 'constructor', '']) {
      expect(permissionsFor([name], 'console')).toEqual([]);
      expect(permissionsFor([name], 'portal')).toEqual([]);
    }
  });
});
