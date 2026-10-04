// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's in-process contract against the test database, as
// app_api, with each call in its own tenant transaction.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import {
  contactDetails,
  ensurePersonForUser,
  isCurrentContact,
  organisationSummaries,
  peopleByUserIds,
  personIdForUser,
} from './index.ts';
import type { Tx } from './tables.ts';

let db: ReturnType<typeof createDatabase<unknown>>;
let tenantA: TestTenant;
let tenantB: TestTenant;

const inTenant = <T>(tenant: TestTenant, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(tenant.id), work);

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
});

afterAll(async () => {
  await db.destroy();
});

describe('ensurePersonForUser', () => {
  it('makes a person from the account once, with the email in lower case', async () => {
    const userId = await createTestUser();
    const first = await inTenant(tenantA, (tx) =>
      ensurePersonForUser(tx, { userId, email: ' Jo@Example.ORG ' }),
    );
    const again = await inTenant(tenantA, (tx) =>
      ensurePersonForUser(tx, { userId, email: 'other@example.org' }),
    );

    expect(first.created).toBe(true);
    expect(again).toEqual({ personId: first.personId, created: false });
    expect(await inTenant(tenantA, (tx) => contactDetails(tx, first.personId))).toEqual({
      givenName: null,
      email: 'jo@example.org',
    });
  });

  it('makes one person when two first requests arrive together', async () => {
    const userId = await createTestUser();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        inTenant(tenantA, (tx) => ensurePersonForUser(tx, { userId, email: 'race@example.org' })),
      ),
    );

    expect(new Set(results.map((result) => result.personId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it('does not link to an existing person with the same email', async () => {
    const existing = await asMigratorIn(tenantA.id, (client) =>
      addPerson(client, tenantA, { email: 'same@example.org' }),
    );
    const userId = await createTestUser();
    const made = await inTenant(tenantA, (tx) =>
      ensurePersonForUser(tx, { userId, email: 'same@example.org' }),
    );

    expect(made.created).toBe(true);
    expect(made.personId).not.toBe(existing);
  });

  it('keeps the same account a separate person in each tenant', async () => {
    const userId = await createTestUser();
    const inA = await inTenant(tenantA, (tx) =>
      ensurePersonForUser(tx, { userId, email: 'both@example.org' }),
    );
    const inB = await inTenant(tenantB, (tx) =>
      ensurePersonForUser(tx, { userId, email: 'both@example.org' }),
    );

    expect(inA.personId).not.toBe(inB.personId);
    expect(await inTenant(tenantA, (tx) => personIdForUser(tx, userId))).toBe(inA.personId);
    expect(await inTenant(tenantB, (tx) => contactDetails(tx, inA.personId))).toBeNull();
  });
});

describe('reads for other modules', () => {
  it('finds names by account, and only in the tenant', async () => {
    const [named, unnamed] = [await createTestUser(), await createTestUser()];
    const personId = await asMigratorIn(tenantA.id, (client) =>
      addPerson(client, tenantA, { user_id: named, given_name: 'Ada', family_name: 'Lovelace' }),
    );
    await asMigratorIn(tenantB.id, (client) => addPerson(client, tenantB, { user_id: unnamed }));

    const found = await inTenant(tenantA, (tx) =>
      peopleByUserIds(tx, [named, unnamed, randomUUID()]),
    );

    expect([...found.entries()]).toEqual([
      [named, { personId, givenName: 'Ada', familyName: 'Lovelace' }],
    ]);
    expect(await inTenant(tenantA, (tx) => peopleByUserIds(tx, []))).toEqual(new Map());
  });

  it('summarises organisations in the order asked, with verification, leaving out unknown ids', async () => {
    const verifierUser = await createTestUser();
    const verifier = await asMigratorIn(tenantA.id, (client) =>
      insertRow(client, 'app.membership', {
        tenant_id: tenantA.id,
        user_id: verifierUser,
        roles: ['tenant_admin'],
      }),
    );
    const { first, second } = await asMigratorIn(tenantA.id, async (client) => ({
      first: await addOrganisation(client, tenantA, { name: 'Zed Trust' }),
      second: await addOrganisation(client, tenantA, { name: 'Alpha Trust' }),
    }));
    await asMigratorIn(tenantA.id, async (client) => {
      await insertRow(client, 'party.organisation_identifier', {
        tenant_id: tenantA.id,
        organisation_id: first,
        scheme: 'GB-CHC',
        identifier: '1234567',
      });
      await insertRow(client, 'party.organisation_identifier', {
        tenant_id: tenantA.id,
        organisation_id: first,
        scheme: 'GB-COH',
        identifier: '01234567',
      });
      await client.query(
        `UPDATE party.organisation_identifier SET verified_at = now(), verified_by = $1
          WHERE organisation_id = $2 AND scheme = 'GB-CHC'`,
        [verifier, first],
      );
    });

    const summaries = await inTenant(tenantA, (tx) =>
      organisationSummaries(tx, [first, second, first, randomUUID()]),
    );

    expect(summaries.map((summary) => summary.name)).toEqual(['Zed Trust', 'Alpha Trust']);
    expect(summaries[0]?.identifiers).toEqual([
      { scheme: 'GB-CHC', identifier: '1234567', verified: true },
      { scheme: 'GB-COH', identifier: '01234567', verified: false },
    ]);
    expect(summaries[1]?.identifiers).toEqual([]);
    expect(await inTenant(tenantB, (tx) => organisationSummaries(tx, [first, second]))).toEqual([]);
    expect(await inTenant(tenantA, (tx) => organisationSummaries(tx, []))).toEqual([]);
  });

  it('knows who is a current contact, and not after the link ends', async () => {
    const { personId, organisationId } = await asMigratorIn(tenantA.id, async (client) => ({
      personId: await addPerson(client, tenantA),
      organisationId: await addOrganisation(client, tenantA),
    }));
    const linkId = await asMigratorIn(tenantA.id, (client) =>
      insertRow(client, 'party.relationship', {
        tenant_id: tenantA.id,
        type: 'contact_for',
        subject_id: personId,
        subject_kind: 'person',
        object_id: organisationId,
        object_kind: 'organisation',
      }),
    );

    expect(await inTenant(tenantA, (tx) => isCurrentContact(tx, personId, organisationId))).toBe(
      true,
    );
    expect(await inTenant(tenantB, (tx) => isCurrentContact(tx, personId, organisationId))).toBe(
      false,
    );

    await asMigratorIn(tenantA.id, (client) =>
      client.query(`UPDATE party.relationship SET ends_on = current_date WHERE id = $1`, [linkId]),
    );
    expect(await inTenant(tenantA, (tx) => isCurrentContact(tx, personId, organisationId))).toBe(
      false,
    );
  });
});
