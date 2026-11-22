// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the platform enforces before a screening handler runs, read from the
// routes the handlers serve (ADR 0031): each needs a permission only the due
// diligence role holds, a reviewer holds none of them, and deciding a match
// needs a sign-in within the last 5 minutes. The handlers' own tests, with
// the database, are in screening.integration.test.ts.

import { permissionsFor } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import {
  decideScreeningMatch,
  getScreeningMatch,
  getScreeningRun,
  listScreeningMatches,
  listScreeningRuns,
  startScreeningRun,
} from '../../contracts/index.ts';

const routes = {
  startScreeningRun,
  listScreeningRuns,
  getScreeningRun,
  listScreeningMatches,
  getScreeningMatch,
  decideScreeningMatch,
};

describe('the screening routes', () => {
  it.each(Object.entries(routes))(
    '%s is for staff, with a permission and no reviewer access',
    (_name, route) => {
      expect(route.audience).toBe('console');
      expect(route.module).toBe('assure');
      expect(permissionsFor(['reviewer'], 'console')).not.toContain(route.permission);
      expect(permissionsFor(['due_diligence_officer'], 'console')).toContain(route.permission);
    },
  );

  it('lets a programme manager read screening but not start a run or decide a match', () => {
    const held = permissionsFor(['programme_manager'], 'console');
    expect(held).toContain(listScreeningMatches.permission);
    expect(held).not.toContain(startScreeningRun.permission);
    expect(held).not.toContain(decideScreeningMatch.permission);
  });

  it('asks for a fresh sign-in to decide a match, and for no other route', () => {
    expect(decideScreeningMatch.stepUp).toBe(true);
    for (const route of [startScreeningRun, getScreeningMatch, listScreeningMatches]) {
      expect('stepUp' in route && route.stepUp).toBeFalsy();
    }
  });

  it('keeps the person deciding and the note out of the decision body', () => {
    const parsed = decideScreeningMatch.body.safeParse({
      outcome: 'confirmed',
      reason: 'identity_confirmed',
      decidedBy: 'someone',
    });
    expect(parsed.success).toBe(false);
  });
});
