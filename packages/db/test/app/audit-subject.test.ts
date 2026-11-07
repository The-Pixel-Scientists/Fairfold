// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0018: the party an audit event is about (ADR 0027). The
// composite foreign key keeps the subject in the event's tenant, the event
// stays append-only, and a party an event names cannot be deleted.

import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { insertAuditEvent } from '../../src/audit.ts';
import { createDatabase } from '../../src/database.ts';
import { trustedTenantId, withTenant } from '../../src/tenant-context.ts';
import { APP_ROLES, asMigratorRolledBack, databaseSettings, withClient } from '../connect.ts';
import { addParty, addPerson } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

let tenantA: TestTenant;
let tenantB: TestTenant;
let personA: string;
let personB: string;
beforeAll(async () => {
  tenantA = await createTestTenant();
  tenantB = await createTestTenant();
  personA = await asMigratorIn(tenantA.id, (client) => addPerson(client, tenantA));
  personB = await asMigratorIn(tenantB.id, (client) => addPerson(client, tenantB));
}, 30_000);

function event(subjectPartyId: string | null): Row {
  return {
    tenant_id: tenantA.id,
    request_id: randomUUID(),
    actor_kind: 'system',
    action: 'party.person.updated',
    entity_type: 'party.person',
    entity_id: personA,
    changes: {},
    subject_party_id: subjectPartyId,
  };
}

describe('app.audit_event subject_party_id', { timeout: 30_000 }, () => {
  it("is written as app_api for a party in the event's tenant, and left as given", async () => {
    await asRoleIn('app_api', tenantA.id, async (client) => {
      const row = event(personA);
      const { text, values } = insertStatement(client, 'app.audit_event', row);
      await client.query(text, values);
      const { rows } = await client.query(
        'SELECT subject_party_id FROM app.audit_event WHERE request_id = $1',
        [row.request_id],
      );
      expect(rows).toEqual([{ subject_party_id: personA }]);
    });
  });

  it('may be left out', async () => {
    await asRoleIn('app_api', tenantA.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.audit_event', event(null));
      expect(await outcome(client, text, values)).toBe('ok');
    });
  });

  it("refuses another tenant's party, or one that does not exist", async () => {
    await asRoleIn('app_api', tenantA.id, async (client) => {
      for (const subject of [personB, randomUUID()]) {
        const { text, values } = insertStatement(client, 'app.audit_event', event(subject));
        expect(await outcome(client, text, values)).toBe('23503');
      }
    });
  });

  it('is written by insertAuditEvent', async () => {
    const db: Kysely<unknown> = createDatabase(databaseSettings('app_api', 1));
    const requestId = randomUUID();
    try {
      await withTenant(db, trustedTenantId(tenantA.id), (trx) =>
        insertAuditEvent(trx, {
          requestId,
          actorKind: 'system',
          actorId: null,
          action: 'party.person.updated',
          entityType: 'party.person',
          entityId: personA,
          changes: {},
          subjectPartyId: personA,
        }),
      );
    } finally {
      await db.destroy();
    }
    const { rows } = await asMigratorIn(tenantA.id, (client) =>
      client.query('SELECT subject_party_id FROM app.audit_event WHERE request_id = $1', [
        requestId,
      ]),
    );
    expect(rows).toEqual([{ subject_party_id: personA }]);
  });

  it('cannot be updated or deleted by an app role', async () => {
    await asRoleIn('app_api', tenantA.id, async (client) => {
      const { text, values } = insertStatement(client, 'app.audit_event', event(personA));
      await client.query(text, values);
      expect(await outcome(client, 'UPDATE app.audit_event SET subject_party_id = NULL')).toBe(
        '42501',
      );
      expect(
        await outcome(client, 'DELETE FROM app.audit_event WHERE subject_party_id = $1', [personA]),
      ).toBe('42501');
    });
  });

  it('keeps a party an event names from being deleted', async () => {
    const outcomes = await asMigratorRolledBack(async (client) => {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenantA.id]);
      const named = await addParty(client, tenantA, 'person');
      const unnamed = await addParty(client, tenantA, 'person');
      const { text, values } = insertStatement(client, 'app.audit_event', event(named));
      await client.query(text, values);
      const remove = 'DELETE FROM party.party WHERE id = $1';
      return [await outcome(client, remove, [named]), await outcome(client, remove, [unnamed])];
    });
    expect(outcomes).toEqual(['23503', 'ok']);
  });

  it('is insertable by the roles that insert events, and no other', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ role: string }>(
        `SELECT r.role FROM pg_catalog.unnest($1::text[]) AS r(role)
          WHERE pg_catalog.has_column_privilege(r.role, 'app.audit_event', 'subject_party_id',
                                                'INSERT')
          ORDER BY 1`,
        [APP_ROLES],
      ),
    );
    expect(rows.map((row) => row.role)).toEqual(['app_api', 'app_worker']);
  });

  it('has a validated key that never cascades, and an index for subject access', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query(
        `SELECT o.convalidated AS validated, o.confdeltype AS on_delete,
                pg_catalog.pg_get_indexdef('app.audit_event_subject'::regclass) AS index
           FROM pg_catalog.pg_constraint o
          WHERE o.conrelid = 'app.audit_event'::regclass
            AND o.conname = 'audit_event_subject_party'`,
      ),
    );
    expect(rows).toEqual([
      {
        validated: true,
        on_delete: 'a',
        index:
          'CREATE INDEX audit_event_subject ON app.audit_event USING btree (tenant_id, subject_party_id) WHERE (subject_party_id IS NOT NULL)',
      },
    ]);
  });
});
