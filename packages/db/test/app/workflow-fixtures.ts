// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the workflow and approval tests (migrations 0093 to 0096):
// members with live sessions, stored definitions, and app_api transactions
// that act through a member's session, as withTenant() will set it.

import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import { withClient } from '../connect.ts';
import { addMember, asRoleIn, insertRow, type Row, type TestTenant } from '../tenants.ts';

export interface Member {
  readonly id: string;
  readonly token: Buffer;
}

export interface SessionOptions {
  readonly app?: 'console' | 'portal';
  readonly mfaState?: 'enrol' | 'verify' | 'complete' | 'not_required';
  /** How long ago the member last signed in again, as an interval. */
  readonly reauthenticated?: string;
  readonly activeTenant?: string;
  readonly revoked?: boolean;
}

/**
 * Add a member to the tenant set on `client`, connected as migrator, with a
 * live console session past MFA unless `options` say otherwise.
 */
export async function addSessionMember(
  client: pg.ClientBase,
  tenant: TestTenant,
  options: SessionOptions = {},
): Promise<Member> {
  const id = await addMember(client, tenant, ['programme_manager']);
  const token = randomBytes(32);
  const app = options.app ?? 'console';
  await client.query(
    `INSERT INTO auth.session (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at,
                               reauthenticated_at, revoked_at)
     SELECT m.user_id, $2, $3, $4, $5, now() + interval '1 day', now() - $6::interval,
            CASE WHEN $7 THEN now() END
       FROM app.membership m WHERE m.id = $1`,
    [
      id,
      token,
      app,
      options.activeTenant ?? tenant.id,
      options.mfaState ?? (app === 'portal' ? 'not_required' : 'complete'),
      options.reauthenticated ?? '0 minutes',
      options.revoked ?? false,
    ],
  );
  return { id, token };
}

/** A definition key no other test has used, for a definition per call. */
export function uniqueKey(): string {
  const letters = [...randomBytes(10)].map((byte) => String.fromCharCode(97 + (byte % 26)));
  return `finance.flow_${letters.join('')}`;
}

/** A definition document with one approval step, `release`, as the server stores it. */
export function definitionDocument(
  key: string,
  version: number,
  approvers: number,
  dueAfterDays?: number,
): Row {
  return {
    key,
    version,
    sensitiveRead: false,
    states: [
      { id: 'draft', label: 'Draft' },
      { id: 'released', label: 'Released', terminal: true },
    ],
    initial: 'draft',
    transitions: [
      {
        from: 'draft',
        to: 'released',
        label: 'Release payment',
        permission: 'finance.payments.release',
        approval: 'release',
      },
    ],
    approvalSteps: [
      {
        id: 'release',
        label: 'Release payment',
        approveLabel: 'Approve payment',
        rejectLabel: 'Reject payment',
        permission: 'finance.payments.approve',
        approvers,
        movesMoney: true,
        ...(dueAfterDays === undefined ? {} : { dueAfterDays }),
      },
    ],
  };
}

/**
 * Add and commit a definition in `tenant` through `author`'s session, as
 * app_api, with one version per approver count in `approvers`, and return
 * the version ids. The author must already be committed.
 */
export function addDefinition(
  tenant: TestTenant,
  author: Member,
  approvers: readonly number[],
  dueAfterDays?: number,
): Promise<string[]> {
  return committedAs(tenant.id, author, async (client) => {
    const key = uniqueKey();
    const definition = await insertRow(client, 'app.workflow_definition', {
      tenant_id: tenant.id,
      key,
      created_by: author.id,
    });
    const versions: string[] = [];
    for (const [index, count] of approvers.entries()) {
      versions.push(
        await insertRow(client, 'app.workflow_definition_version', {
          tenant_id: tenant.id,
          definition_id: definition,
          version: index + 1,
          document: definitionDocument(key, index + 1, count, dueAfterDays),
          created_by: author.id,
        }),
      );
    }
    return versions;
  });
}

/** Act through `member`'s session for the rest of the transaction, or through none. */
export async function actAs(client: pg.ClientBase, member: Member | undefined): Promise<void> {
  await client.query("SELECT pg_catalog.set_config('app.session_token_hash', $1, true)", [
    member?.token.toString('hex') ?? '',
  ]);
}

/** Run `work` as app_api in `tenant`, acting as `member`, and roll it back. */
export function asMember<T>(
  tenant: string,
  member: Member,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return asRoleIn('app_api', tenant, async (client) => {
    await actAs(client, member);
    return work(client);
  });
}

/** Run `work` as app_api in `tenant`, acting as `member`, and commit it. */
export function committedAs<T>(
  tenant: string,
  member: Member,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  return withClient('app_api', async (client) => {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant]);
      await actAs(client, member);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** Ask for the `release` step of `version` as `member`, on `client`, and return the request id. */
export function ask(client: pg.ClientBase, tenant: string, version: string, member: Member) {
  return insertRow(client, 'app.approval_request', {
    tenant_id: tenant,
    definition_version_id: version,
    step_id: 'release',
    requested_by: member.id,
  });
}

/** Record `member`'s decision on `request`, on `client`. */
export function decide(
  client: pg.ClientBase,
  tenant: string,
  request: string,
  member: Member,
  outcome: 'approve' | 'reject' = 'approve',
) {
  return insertRow(client, 'app.approval_decision', {
    tenant_id: tenant,
    request_id: request,
    decided_by: member.id,
    outcome,
    reason_code: outcome === 'reject' ? 'missing_evidence' : null,
  });
}

/**
 * Run one statement in a savepoint: ok, or its SQLSTATE and, where the
 * error names one, its constraint. The savepoint is undone unless `keep` is
 * set and the statement succeeded.
 */
export async function attempt(
  client: pg.ClientBase,
  text: string,
  values: readonly unknown[] = [],
  keep = false,
): Promise<string> {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(text, [...values]);
    await client.query(keep ? 'RELEASE SAVEPOINT attempt' : 'ROLLBACK TO SAVEPOINT attempt');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    const { code, constraint } = error as pg.DatabaseError;
    if (!code) throw error;
    return constraint ? `${code} ${constraint}` : code;
  }
}
