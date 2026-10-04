// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the auth schema tests (migration 0004).

import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../../scripts/roles.ts';
import { withClient } from '../connect.ts';
import { testSlug } from '../tenants.ts';

export const AUTH_TABLES = [
  'auth.user',
  'auth.session',
  'auth.account',
  'auth.verification',
  'auth.two_factor',
  'auth.rate_limit',
  'auth.audit_event',
  'auth.audit_copy_pending',
] as const;

/** Run `work` as `role` in a transaction, and roll it back. */
export function asRoleRolledBack<T>(
  role: LoginRole,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return withClient(role, async (client) => {
    await client.query('BEGIN');
    try {
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

/** Add an account through `client` and return its id. */
export async function addUser(client: pg.ClientBase, status?: string): Promise<string> {
  const email = `${testSlug()}@example.test`;
  const { rows } = await client.query<{ id: string }>(
    status === undefined
      ? 'INSERT INTO auth."user" (email) VALUES ($1) RETURNING id'
      : 'INSERT INTO auth."user" (email, status) VALUES ($1, $2) RETURNING id',
    status === undefined ? [email] : [email, status],
  );
  const [row] = rows;
  if (!row) throw new Error('The insert into auth.user returned no row.');
  return row.id;
}

/** A random 32-byte value, the size of a SHA-256 token hash. */
export function tokenHash(): Buffer {
  return randomBytes(32);
}
