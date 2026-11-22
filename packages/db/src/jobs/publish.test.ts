// SPDX-License-Identifier: AGPL-3.0-or-later
//
// publish() checks the event before it writes anything, and writes the
// outbox row with only the columns the caller may set, on a recording
// driver so no database is needed. The rows, numbers, jobs and rollbacks are
// in test/events and test/jobs.

import { randomUUID } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';
import { defineEvent, type EventDefinition } from '@pixel-scientists/domain/events';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { publish, type PublishContext } from './publish.ts';
import type { JobSender } from './send.ts';

const read = 'grants.applications.read';
const submitted = defineEvent('grants.publish_unit_submitted.v1', {
  read,
  data: z.strictObject({ applicationId: idSchema, timing: z.enum(['late', 'on_time']) }),
});
const SECRET = 'jane.doe@example.test';

/** A driver whose every query is recorded, answering the tenant and outbox queries. */
function recording(tenant: string | null) {
  const sent: CompiledQuery[] = [];
  const occurredAt = new Date('2026-11-18T10:00:00.000Z');
  const connection: DatabaseConnection = {
    executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      sent.push(query);
      const rows = query.sql.includes('current_tenant_id')
        ? [{ tenant }]
        : query.sql.includes('app.event_outbox')
          ? [{ sequence: '7', occurred_at: occurredAt }]
          : [];
      return Promise.resolve({ rows: rows as R[] });
    },
    streamQuery() {
      throw new Error('publish() never streams.');
    },
  };
  class Driver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve(connection);
    }
  }
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new Driver(),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const outbox = () => sent.filter((query) => query.sql.includes('app.event_outbox'));
  return { db, outbox };
}

const context = (): PublishContext => ({
  sender: {} as JobSender,
  requestId: randomUUID(),
  causingUserId: null,
  causedBy: randomUUID(),
});

describe('publish', () => {
  it("writes one outbox row in the transaction's tenant, leaving number and times to the database", async () => {
    const tenant = randomUUID();
    const { db, outbox } = recording(tenant);
    const data = { applicationId: randomUUID(), timing: 'late' as const };
    const ctx = context();
    await db.transaction().execute((trx) => publish(trx, submitted, data, ctx));
    const [insert, ...more] = outbox();
    expect(more).toEqual([]);
    expect(insert?.sql).toMatch(
      /INSERT INTO app\.event_outbox \(tenant_id, id, type, payload, request_id, caused_by\)/,
    );
    expect(insert?.parameters).toEqual([
      tenant,
      expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      submitted.name,
      JSON.stringify(data),
      ctx.requestId,
      ctx.causedBy,
    ]);
  });

  const lookAlike = {
    name: 'grants.publish_unit_free_text.v1',
    read,
    data: z.strictObject({ note: z.string() }),
  } as unknown as EventDefinition;

  it.each([
    ['free text where an id goes', submitted, { applicationId: SECRET, timing: 'late' }],
    ['a key the event does not define', submitted, { applicationId: randomUUID(), note: SECRET }],
    ['an event defineEvent() never made', lookAlike, { note: SECRET }],
  ])('refuses %s before writing anything', async (_, event, data) => {
    const { db, outbox } = recording(randomUUID());
    const attempt = db
      .transaction()
      .execute((trx) => publish(trx, event, data as never, context()));
    await expect(attempt).rejects.toMatchObject({ name: 'EventParseError' });
    await expect(attempt).rejects.not.toThrow(SECRET);
    expect(outbox()).toEqual([]);
  });

  it('refuses a transaction with no tenant before writing anything', async () => {
    const { db, outbox } = recording(null);
    const data = { applicationId: randomUUID(), timing: 'on_time' as const };
    await expect(
      db.transaction().execute((trx) => publish(trx, submitted, data, context())),
    ).rejects.toMatchObject({ name: 'JobSendError', code: 'no_tenant' });
    expect(outbox()).toEqual([]);
  });
});
