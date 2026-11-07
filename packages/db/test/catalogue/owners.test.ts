// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migrations never create roles (ADR 0003), so the owner of every approved
// definer function in the catalogue must be one the roles script creates.
// A missing one fails the migration that assigns it, on every fresh database.

import { describe, expect, it } from 'vitest';

import { OWNER_ROLES } from '../../scripts/roles.ts';
import { DEFINER_FUNCTIONS } from './index.ts';

describe('the definer function owners', () => {
  it('are all created by the roles script', () => {
    const created: ReadonlySet<string> = new Set(OWNER_ROLES);
    const missing = [...DEFINER_FUNCTIONS]
      .filter(([, { owner }]) => !created.has(owner))
      .map(([signature, { owner }]) => `${signature} owned by ${owner}`);
    expect(missing).toEqual([]);
  });
});
