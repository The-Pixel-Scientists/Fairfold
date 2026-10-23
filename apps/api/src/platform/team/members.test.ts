// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { leavesNoManager } from './members.ts';
import type { MembershipRow } from './tables.ts';

const row = (id: string, roles: string[], status: MembershipRow['status'] = 'active') => ({
  id,
  user_id: `user-${id}`,
  roles,
  status,
});

const admin = row('a', ['tenant_admin']);
const other = row('b', ['tenant_admin']);
const reviewer = row('c', ['reviewer']);

describe('leavesNoManager', () => {
  it('refuses to take the last administrator’s access by suspension, removal or roles', () => {
    const team = [admin, reviewer];
    expect(leavesNoManager(team, admin, { status: 'suspended' })).toBe(true);
    expect(leavesNoManager(team, admin, { status: 'removed' })).toBe(true);
    expect(leavesNoManager(team, admin, { roles: ['reviewer'] })).toBe(true);
  });

  it('allows it while another active administrator remains', () => {
    const team = [admin, other, reviewer];
    expect(leavesNoManager(team, admin, { status: 'suspended' })).toBe(false);
    expect(leavesNoManager(team, admin, { roles: ['reviewer'] })).toBe(false);
  });

  it('does not count a suspended administrator as one who remains', () => {
    const team = [admin, row('b', ['tenant_admin'], 'suspended')];
    expect(leavesNoManager(team, admin, { status: 'removed' })).toBe(true);
  });

  it('allows a change that keeps the access, or to a member without it', () => {
    expect(leavesNoManager([admin], admin, { roles: ['tenant_admin', 'reviewer'] })).toBe(false);
    expect(leavesNoManager([admin, reviewer], reviewer, { status: 'suspended' })).toBe(false);
  });
});
