// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the privacy integration tests share (a test file, so it may reach the
// database test fixtures): the handlers run as app_api in a
// tenant's transaction against the test database, with the audit writer
// replaced by one that keeps the events, and the server clock fixed.

import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import type { AuditChanges } from '@pixel-scientists/db';

import type { PrivacyAuditAction } from '../contracts/index.ts';
import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import { addMember, asMigratorIn, createTestTenant } from '../../../../packages/db/test/tenants.ts';
import type { TestTenant } from '../../../../packages/db/test/tenants.ts';
import type { PrivacyContext, PrivacyDependencies, Tx } from './context.ts';
import { privacySubjectRules } from './audit.ts';
import { privacyHandlers } from './index.ts';

/** A Wednesday, in the winter, so the tenant's time zone is UTC. */
export const NOW = new Date('2026-11-18T12:00:00Z');

/**
 * The server clock the handlers read. It starts fixed. A test that records clock events sets it to
 * the real time, since the database stamps each event with its own clock.
 */
export const clock = { now: NOW };

export class Refusal extends Error {
  readonly status: number;
  readonly errors: readonly { field: string; message: string }[];

  constructor(
    status: number,
    detail: string,
    errors: readonly { field: string; message: string }[] = [],
  ) {
    super(detail);
    this.status = status;
    this.errors = errors;
  }
}

export const deps: PrivacyDependencies = {
  notFound: () => new Refusal(404, 'Not found'),
  refuse: (status, detail, errors) => new Refusal(status, detail, errors),
  tenantTimeZone: () => Promise.resolve('Europe/London'),
  now: () => clock.now,
  nonWorkingDates: () => Promise.resolve(new Set()),
};

export const handlers = privacyHandlers(deps);

export interface Fixture {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly second: string;
  readonly person: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;

export function openDatabase(): void {
  const settings = databaseSettings('app_api', 4);
  db = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
}

export const closeDatabase = () => db.destroy();

/** A tenant with two members and a person, as migrator. */
export async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => ({
    tenant,
    member: await addMember(client, tenant),
    second: await addMember(client, tenant),
    person: await addPerson(client, tenant),
  }));
}

export interface AuditRecord {
  readonly kind: 'record' | 'read';
  readonly action: string;
  readonly entityId: string;
  readonly changes?: unknown;
  /** The party the action's rule finds, or null where it has none. */
  readonly subject: string | null;
}

/** Runs `work` as `member` in the fixture's tenant, answering what it returned and the audit events it wrote. */
export async function as<T>(
  fixture: Fixture,
  member: string,
  work: (tx: Tx, context: PrivacyContext) => Promise<T>,
): Promise<{ result: T; events: AuditRecord[] }> {
  const events: AuditRecord[] = [];
  const result = await withTenant(db, trustedTenantId(fixture.tenant.id), async (tx) => {
    const keep =
      (kind: AuditRecord['kind']) =>
      async (event: { action: PrivacyAuditAction; entityId: string; changes?: AuditChanges }) => {
        const rule = privacySubjectRules[event.action];
        events.push({
          kind,
          ...event,
          subject: 'subject' in rule ? await rule.subject(tx, event) : null,
        });
      };
    return work(tx, {
      audit: { record: keep('record'), read: keep('read') },
      session: { tenant: fixture.tenant.id },
      membership: { id: member },
    });
  });
  return { result, events };
}

export const unknownId = (): string => randomUUID();

/** What a refused call threw, or fails the test if it did not. */
export async function refusal(call: Promise<unknown>): Promise<Refusal> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Refusal) return error;
    throw error;
  }
  throw new Error('The call was not refused.');
}

it('judges every deadline by the fixed clock, and reports a call that was not refused', async () => {
  expect(deps.now()).toBe(clock.now);
  expect(await refusal(Promise.reject(deps.notFound()))).toMatchObject({ status: 404 });
  await expect(refusal(Promise.resolve())).rejects.toThrow('The call was not refused.');
});
