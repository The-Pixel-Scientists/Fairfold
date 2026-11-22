// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  permissions,
  reachScopeRules,
  restrictableRecords,
  scopeRules,
  type Permission,
} from './access.ts';
import { moduleIds, modules, switchableModuleIds } from './modules.ts';

const permissionIds = Object.keys(permissions) as Permission[];

describe('permissions', () => {
  it('are named <module>.<subject>.<verb> for a module that exists', () => {
    for (const permission of permissionIds) {
      expect(permission).toMatch(/^[a-z]+\.[a-z_]+\.[a-z_]+$/);
      expect(moduleIds).toContain(permission.split('.')[0]);
    }
  });

  it('have labels in sentence case', () => {
    for (const permission of permissionIds) {
      expect(permissions[permission].label).toMatch(/^[A-Z][a-z]/);
    }
  });

  it('use only scope rules of their own app', () => {
    for (const id of permissionIds) {
      const { app, scopes } = permissions[id];
      expect(scopes.length).toBeGreaterThan(0);
      for (const scope of scopes) expect(scopeRules[scope].app, `${id} ${scope}`).toBe(app);
    }
  });

  it('let reviewers reach only applications assigned to them', () => {
    expect(permissions['grants.reviews.score'].scopes).toEqual(['assigned_review']);
  });

  it('need step-up for members, teams, emergency access, exports, erasure, retention, SSO, approvals, merges, imports, releases, monitoring answers and match decisions', () => {
    const stepUp = permissionIds.filter((id) => 'stepUp' in permissions[id]);
    expect(stepUp).toEqual([
      'platform.members.manage',
      'platform.audit.export',
      'platform.retention.manage',
      'platform.subject_access.request',
      'platform.erasure.request',
      'platform.sso.manage',
      'platform.approvals.decide',
      'platform.teams.manage',
      'platform.break_glass.use',
      'grants.decisions.release',
      'grants.monitoring.disclose',
      'crm.records.export',
      'crm.parties.merge',
      'crm.imports.run',
      'assure.screening.decide',
      'forms.retention.manage',
      'forms.responses.export',
      'privacy.requests.export',
      'privacy.requests.erase',
    ]);
  });

  it('never need step-up only to read; opening emergency access is a change', () => {
    const reads = permissionIds.filter(
      (id) => /\.(read|use|report)$/.test(id) && id !== 'platform.break_glass.use',
    );
    for (const id of reads) expect('stepUp' in permissions[id], id).toBe(false);
  });
});

describe('modules and scope rules', () => {
  it('switch grants and the tools after it, never the platform or party, and give each schema to one module', () => {
    expect(switchableModuleIds).toEqual([
      'grants',
      'crm',
      'assure',
      'forms',
      'privacy',
      'insight',
      'impact',
    ]);
    const schemas = moduleIds.flatMap((id) => modules[id].schemas);
    expect(new Set(schemas).size).toBe(schemas.length);
  });

  it('name a module that exists for every scope rule, and keep tenant-wide reach in the console', () => {
    for (const rule of Object.values(scopeRules)) expect(moduleIds).toContain(rule.module);
    expect(scopeRules.tenant.app).toBe('console');
  });

  it('reach restrictable records only in the console, through the platform, under no permission yet', () => {
    for (const rule of reachScopeRules) {
      expect(scopeRules[rule]).toEqual({ module: 'platform', app: 'console' });
      for (const id of permissionIds) {
        expect(permissions[id].scopes as readonly string[], id).not.toContain(rule);
      }
    }
    expect(restrictableRecords).toEqual([]);
  });

  it('keep the rules that came before record-level reach', () => {
    expect(scopeRules).toMatchObject({
      tenant: { module: 'platform', app: 'console' },
      assigned_review: { module: 'grants', app: 'console' },
      own_person: { module: 'party', app: 'portal' },
      own_organisation: { module: 'party', app: 'portal' },
      own_application: { module: 'grants', app: 'portal' },
    });
  });

  it('let a signed-in respondent reach only their own responses and forms taking responses', () => {
    expect(scopeRules.own_response).toEqual({ module: 'forms', app: 'portal' });
    expect(scopeRules.open_form).toEqual({ module: 'forms', app: 'portal' });
    expect(permissions['forms.responses.submit'].scopes).toEqual(['own_response', 'open_form']);
  });
});
