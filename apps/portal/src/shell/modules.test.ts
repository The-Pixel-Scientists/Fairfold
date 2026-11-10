// SPDX-License-Identifier: AGPL-3.0-or-later

import { moduleIds, modules } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { applicantSession } from '../testing/api.ts';
import { portalModules, visibleSections } from './modules.ts';

const ids = (session: Parameters<typeof visibleSections>[0]) =>
  visibleSections(session).map(({ id }) => id);

describe('the portal sections', () => {
  it('name only known modules, and no switchable-less module but party', () => {
    for (const { id } of portalModules) {
      expect(moduleIds).toContain(id);
      expect(id === 'party' || modules[id].switchable).toBe(true);
    }
    expect(new Set(portalModules.map(({ id }) => id)).size).toBe(portalModules.length);
  });

  it('start with party, then grants', () => {
    expect(portalModules.map(({ id }) => id)).toEqual(['party', 'grants']);
  });
});

describe('visibleSections', () => {
  it('shows a tool that is on and permitted', () => {
    expect(ids(applicantSession({ modules: ['grants'] }))).toEqual(['party', 'grants']);
  });

  it('hides a tool that is on but not permitted', () => {
    expect(ids({ ...applicantSession(), permissions: ['party.profile.manage'] })).toEqual([
      'party',
    ]);
  });

  it('hides a tool that is off, even when permitted', () => {
    expect(ids(applicantSession({ modules: [] }))).toEqual(['party']);
  });

  it('counts a tool missing from the list as off', () => {
    const session = { ...applicantSession(), modules: undefined };
    expect(ids(session)).toEqual(['party']);
  });

  it('shows nothing without a session', () => {
    expect(ids(null)).toEqual([]);
  });
});
