// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the snapshot tests (migration 0019): a snapshot is taken by
// naming the organisation and the member; the database copies the rest.

import type pg from 'pg';

import { insertRow } from '../tenants.ts';

/** Snapshot `organisation` as it is now, taken by `member`, and return its id. */
export function addSnapshot(
  client: pg.ClientBase,
  organisation: string,
  member: string,
): Promise<string> {
  return insertRow(client, 'party.organisation_snapshot', {
    organisation_id: organisation,
    taken_by: member,
  });
}
