// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The staff handlers that change party records, against the test database as
// app_api, each call in its own tenant transaction. Names, emails and
// identifier values here are invented and recognisable, so a test can prove
// that none reaches an audit event or a problem.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { partyAuditActions, partyMessages, partyRecordRoutes } from '../contracts/index.ts';
import { partySubjectRules } from './audit.ts';
import type { PartyContext } from './handlers.ts';
import { partyRecordHandlers } from './record-handlers.ts';
import type { Tx } from './tables.ts';

class Refused extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

const handlers = partyRecordHandlers({
  notFound: () => new Refused(404, 'Not found'),
  refuse: (status, detail) => new Refused(status, detail),
});

interface Staff {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly organisation: string;
  readonly person: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Staff;
let b: Staff;

async function fixture(): Promise<Staff> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => ({
    tenant,
    member: await addMember(client, tenant),
    organisation: await addOrganisation(client, tenant, {
      name: 'Marlow Tenants Association',
      website: 'https://marlow.example.org',
    }),
    person: await addPerson(client, tenant, { given_name: 'Priya', family_name: 'Okafor' }),
  }));
}

/** An audit trail that keeps what a handler wrote, with the member and a session. */
function request(staff: Staff) {
  const events: Record<string, unknown>[] = [];
  const context: PartyContext = {
    audit: {
      record: (event) => Promise.resolve(void events.push({ read: false, ...event })),
      read: (event) => Promise.resolve(void events.push({ read: true, ...event })),
    },
    session: { userId: randomUUID(), email: () => Promise.resolve('staff@example.test') },
    membership: { id: staff.member },
  };
  return { events, context };
}

const inTenant = <T>(staff: Staff, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(staff.tenant.id), work);

const asMigrator = <T>(staff: Staff, sql: string, values: unknown[] = []) =>
  asMigratorIn(
    staff.tenant.id,
    async (client) => (await client.query<T & object>(sql, values)).rows,
  );

const history = (staff: Staff, party: string) =>
  asMigrator<{ field_id: string; old_value: string | null; new_value: string | null }>(
    staff,
    'SELECT field_id, old_value, new_value, changed_by FROM party.value_history WHERE party_id = $1 ORDER BY field_id',
    [party],
  );

const details = {
  name: 'Marlow Residents Association',
  legalForm: 'unincorporated_group',
  registeredAddress: {
    line1: '2 Mill Lane',
    line2: null,
    town: 'Marlow',
    postcode: 'SL7 1AA',
    countryCode: 'GB',
  },
  website: 'https://marlow.example.org',
} as const;

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
  [a, b] = await Promise.all([fixture(), fixture()]);
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('the routes', () => {
  it('all need party.records.manage in the whole tenant, in the console only', () => {
    for (const route of Object.values(partyRecordRoutes)) {
      expect(route).toMatchObject({
        permission: 'party.records.manage',
        scope: 'tenant',
        audience: 'console',
      });
    }
  });
});

describe('updateOrganisation', () => {
  it('changes the details, keeps one history row for each changed field and audits field ids only', async () => {
    const { events, context } = request(a);
    const updated = await inTenant(a, (tx) =>
      handlers.updateOrganisation({
        tx,
        context,
        input: {
          params: { organisationId: a.organisation },
          body: {
            ...details,
            registeredAddress: { ...details.registeredAddress, line2: undefined },
          },
        },
      }),
    );

    expect(updated.name).toBe('Marlow Residents Association');
    expect(await history(a, a.organisation)).toEqual([
      expect.objectContaining({
        field_id: 'organisation.address_line1',
        old_value: '1 High Street',
        new_value: '2 Mill Lane',
        changed_by: a.member,
      }),
      expect.objectContaining({
        field_id: 'organisation.address_postcode',
        old_value: 'NF1 2AB',
        new_value: 'SL7 1AA',
      }),
      expect.objectContaining({
        field_id: 'organisation.address_town',
        old_value: 'Northfield',
        new_value: 'Marlow',
      }),
      expect.objectContaining({
        field_id: 'organisation.legal_form',
        old_value: 'community_benefit_society',
        new_value: 'unincorporated_group',
      }),
      expect.objectContaining({
        field_id: 'organisation.name',
        old_value: 'Marlow Tenants Association',
        new_value: 'Marlow Residents Association',
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'party.organisation.updated',
      entityId: a.organisation,
      read: false,
    });
    const trail = JSON.stringify(events);
    for (const value of ['Marlow', 'Mill Lane', 'SL7', 'Tenants', 'Residents']) {
      expect(trail).not.toContain(value);
    }
    const rule = partySubjectRules['party.organisation.updated'];
    expect(
      'subject' in rule && (await inTenant(a, (tx) => rule.subject(tx, events[0] as never))),
    ).toBe(a.organisation);
  });

  it('writes nothing, audit included, when no field changes', async () => {
    const before = await history(a, a.organisation);
    const { events, context } = request(a);
    await inTenant(a, (tx) =>
      handlers.updateOrganisation({
        tx,
        context,
        input: { params: { organisationId: a.organisation }, body: details as never },
      }),
    );

    expect(events).toEqual([]);
    expect(await history(a, a.organisation)).toEqual(before);
  });

  it('leaves neither the change nor its history when the request fails afterwards', async () => {
    const { context } = request(a);
    const failed = inTenant(a, async (tx) => {
      await handlers.updateOrganisation({
        tx,
        context,
        input: {
          params: { organisationId: a.organisation },
          body: { ...details, name: 'Rolled Back Trust' } as never,
        },
      });
      throw new Error('the request failed after the update');
    });

    await expect(failed).rejects.toThrow('after the update');
    const [row] = await asMigrator<{ name: string }>(
      a,
      'SELECT name FROM party.organisation WHERE id = $1',
      [a.organisation],
    );
    expect(row?.name).toBe('Marlow Residents Association');
    expect(
      (await history(a, a.organisation)).some((h) => h.new_value === 'Rolled Back Trust'),
    ).toBe(false);
  });

  it('refuses a merged organisation with a plain problem and changes nothing', async () => {
    const [survivor, loser] = await asMigratorIn(a.tenant.id, async (client) => {
      const survivorId = await addOrganisation(client, a.tenant);
      const loserId = await addOrganisation(client, a.tenant);
      await client.query(
        "UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1",
        [loserId, survivorId],
      );
      return [survivorId, loserId];
    });
    const { events, context } = request(a);
    const refused = inTenant(a, (tx) =>
      handlers.updateOrganisation({
        tx,
        context,
        input: { params: { organisationId: loser }, body: details as never },
      }),
    );

    await expect(refused).rejects.toMatchObject({
      status: 409,
      detail: expect.stringContaining('merged') as string,
    });
    expect(events).toEqual([]);
    expect(await history(a, loser)).toEqual([]);
    expect(survivor).not.toBe(loser);
  });

  it('answers 404 for another tenant’s organisation, exactly as for a missing one, and writes nothing', async () => {
    const { events, context } = request(a);
    for (const organisationId of [b.organisation, randomUUID()]) {
      const attempt = inTenant(a, (tx) =>
        handlers.updateOrganisation({
          tx,
          context,
          input: { params: { organisationId }, body: { ...details, name: 'Taken Over' } as never },
        }),
      );
      await expect(attempt).rejects.toMatchObject({ status: 404 });
    }

    expect(events).toEqual([]);
    const [row] = await asMigrator<{ name: string }>(
      b,
      'SELECT name FROM party.organisation WHERE id = $1',
      [b.organisation],
    );
    expect(row?.name).toBe('Marlow Tenants Association');
  });
});

describe('updatePerson', () => {
  it('changes the name and phone, keeps history, and audits field ids only', async () => {
    const { events, context } = request(a);
    const updated = await inTenant(a, (tx) =>
      handlers.updatePerson({
        tx,
        context,
        input: {
          params: { personId: a.person },
          body: { givenName: 'Priyanka', familyName: 'Okafor', phone: '01632 960 111' },
        },
      }),
    );

    expect(updated).toMatchObject({ givenName: 'Priyanka', phone: '01632 960 111' });
    expect(await history(a, a.person)).toEqual([
      expect.objectContaining({
        field_id: 'person.given_name',
        old_value: 'Priya',
        new_value: 'Priyanka',
      }),
      expect.objectContaining({
        field_id: 'person.phone',
        old_value: null,
        new_value: '01632 960 111',
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(/Priya|Okafor|960/);
  });

  it('refuses an erased person and a person of another tenant', async () => {
    const erased = await asMigratorIn(a.tenant.id, async (client) => {
      const id = await addPerson(client, a.tenant, { given_name: 'Gone' });
      await client.query('UPDATE party.person SET given_name = NULL, email = $1 WHERE id = $2', [
        `${id}@erased.invalid`,
        id,
      ]);
      await client.query("UPDATE party.party SET status = 'erased' WHERE id = $1", [id]);
      return id;
    });
    const { context } = request(a);
    const body = { givenName: 'Back', familyName: 'Again' };

    await expect(
      inTenant(a, (tx) =>
        handlers.updatePerson({ tx, context, input: { params: { personId: erased }, body } }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      inTenant(a, (tx) =>
        handlers.updatePerson({ tx, context, input: { params: { personId: b.person }, body } }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('identifiers', () => {
  it('adds an unverified identifier once per scheme and keeps it in history', async () => {
    const { events, context } = request(a);
    const input = {
      params: { organisationId: a.organisation },
      body: { scheme: 'GB-CHC', identifier: '1000001' } as const,
    };
    const added = await inTenant(a, (tx) => handlers.addIdentifier({ tx, context, input }));

    expect(added).toMatchObject({ scheme: 'GB-CHC', identifier: '1000001', verification: null });
    expect(events).toMatchObject([{ action: 'party.identifier.added', entityId: a.organisation }]);
    expect(JSON.stringify(events)).not.toContain('1000001');
    expect(
      (await history(a, a.organisation)).find((row) => row.field_id === 'organisation.identifier'),
    ).toMatchObject({
      field_id: 'organisation.identifier',
      old_value: null,
      new_value: 'GB-CHC-1000001',
    });
    await expect(
      inTenant(a, (tx) => handlers.addIdentifier({ tx, context, input })),
    ).rejects.toMatchObject({ status: 409, detail: partyMessages.identifierOncePerType });
  });

  it('verifies with the session’s membership and the database’s own time', async () => {
    const { events, context } = request(a);
    const identifier = await asMigratorIn(a.tenant.id, (client) =>
      insertRow(client, 'party.organisation_identifier', {
        tenant_id: a.tenant.id,
        organisation_id: a.organisation,
        scheme: 'GB-COH',
        identifier: '01000002',
      }),
    );
    const input = { params: { organisationId: a.organisation, identifierId: identifier } };
    const verified = await inTenant(a, (tx) => handlers.verifyIdentifier({ tx, context, input }));

    expect(verified.verification).toMatchObject({ verifiedBy: a.member });
    expect(Date.now() - Date.parse(verified.verification?.verifiedAt ?? '')).toBeLessThan(60_000);
    expect(events).toMatchObject([
      { action: 'party.identifier.verified', entityId: a.organisation },
    ]);

    const again = await inTenant(a, (tx) => handlers.verifyIdentifier({ tx, context, input }));
    expect(again.verification?.verifiedAt).toBe(verified.verification?.verifiedAt);
    expect(events).toHaveLength(1);
  });

  it('refuses a value already verified on another organisation, without echoing it', async () => {
    const other = await asMigratorIn(a.tenant.id, async (client) => {
      const id = await addOrganisation(client, a.tenant);
      await client.query(
        `INSERT INTO party.organisation_identifier (tenant_id, organisation_id, scheme, identifier)
         VALUES ($1, $2, 'GB-SC', 'SC123456')`,
        [a.tenant.id, id],
      );
      await client.query(
        'UPDATE party.organisation_identifier SET verified_by = $1 WHERE organisation_id = $2',
        [a.member, id],
      );
      return id;
    });
    const claim = await asMigratorIn(a.tenant.id, (client) =>
      insertRow(client, 'party.organisation_identifier', {
        tenant_id: a.tenant.id,
        organisation_id: a.organisation,
        scheme: 'GB-SC',
        identifier: 'SC123456',
      }),
    );
    const { events, context } = request(a);
    const refused = inTenant(a, (tx) =>
      handlers.verifyIdentifier({
        tx,
        context,
        input: { params: { organisationId: a.organisation, identifierId: claim } },
      }),
    );

    await expect(refused).rejects.toMatchObject({
      status: 409,
      detail: partyMessages.identifierAlreadyVerified,
    });
    expect(partyMessages.identifierAlreadyVerified).not.toContain('SC123456');
    expect(events).toEqual([]);
    expect(other).not.toBe(a.organisation);
  });

  it('answers 404 across tenants for add and verify, and writes nothing', async () => {
    const { events, context } = request(a);
    const foreign = await asMigratorIn(b.tenant.id, (client) =>
      insertRow(client, 'party.organisation_identifier', {
        tenant_id: b.tenant.id,
        organisation_id: b.organisation,
        scheme: 'GB-CHC',
        identifier: '1000003',
      }),
    );

    await expect(
      inTenant(a, (tx) =>
        handlers.addIdentifier({
          tx,
          context,
          input: {
            params: { organisationId: b.organisation },
            body: { scheme: 'GB-SC', identifier: 'SC000001' },
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inTenant(a, (tx) =>
        handlers.verifyIdentifier({
          tx,
          context,
          input: { params: { organisationId: b.organisation, identifierId: foreign } },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(events).toEqual([]);
    const rows = await asMigrator<{ verified_by: string | null }>(
      b,
      'SELECT verified_by FROM party.organisation_identifier WHERE id = $1',
      [foreign],
    );
    expect(rows[0]?.verified_by).toBeNull();
  });
});

describe('relationships', () => {
  it('adds a contact once, answers the current link on a repeat, and ends it without deleting it', async () => {
    const { events, context } = request(a);
    const input = {
      params: { organisationId: a.organisation },
      body: { type: 'contact_for', personId: a.person, startsOn: '2026-01-05' } as const,
    };
    const added = await inTenant(a, (tx) => handlers.addRelationship({ tx, context, input }));
    const repeat = await inTenant(a, (tx) => handlers.addRelationship({ tx, context, input }));

    expect(added).toMatchObject({ type: 'contact_for', startsOn: '2026-01-05', endsOn: null });
    expect(added.from).toMatchObject({ id: a.person, name: 'Priyanka Okafor' });
    expect(repeat.id).toBe(added.id);
    expect(events).toMatchObject([{ action: 'party.relationship.created', entityId: added.id }]);
    const rule = partySubjectRules['party.relationship.created'];
    expect(
      'subject' in rule && (await inTenant(a, (tx) => rule.subject(tx, events[0] as never))),
    ).toBe(a.person);

    await expect(
      inTenant(a, (tx) =>
        handlers.endRelationship({
          tx,
          context,
          input: { params: { relationshipId: added.id }, body: { endsOn: '2026-01-04' } },
        }),
      ),
    ).rejects.toMatchObject({ status: 400, detail: partyMessages.relationshipDates });

    const ended = await inTenant(a, (tx) =>
      handlers.endRelationship({
        tx,
        context,
        input: { params: { relationshipId: added.id }, body: { endsOn: '2026-02-01' } },
      }),
    );
    expect(ended.endsOn).toBe('2026-02-01');
    expect(events.at(-1)).toMatchObject({ action: 'party.relationship.ended', entityId: added.id });
    await expect(
      inTenant(a, (tx) =>
        handlers.endRelationship({
          tx,
          context,
          input: { params: { relationshipId: added.id }, body: { endsOn: '2026-03-01' } },
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await asMigrator(a, 'SELECT id FROM party.relationship WHERE id = $1', [added.id]),
    ).toHaveLength(1);
  });

  it('refuses an organisation as the contact with the kinds message', async () => {
    const { context } = request(a);
    const attempt = inTenant(a, (tx) =>
      handlers.addRelationship({
        tx,
        context,
        input: {
          params: { organisationId: a.organisation },
          body: { type: 'contact_for', personId: b.organisation },
        },
      }),
    );
    await expect(attempt).rejects.toMatchObject({ status: 404 });

    const sameTenant = await asMigratorIn(a.tenant.id, (client) =>
      addOrganisation(client, a.tenant),
    );
    await expect(
      inTenant(a, (tx) =>
        handlers.addRelationship({
          tx,
          context,
          input: {
            params: { organisationId: a.organisation },
            body: { type: 'contact_for', personId: sameTenant },
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 400, detail: partyMessages.relationshipKinds });
  });

  it('answers 404 across tenants for add and end, and writes nothing', async () => {
    const { events, context } = request(a);
    const foreign = await asMigratorIn(b.tenant.id, (client) =>
      insertRow(client, 'party.relationship', {
        tenant_id: b.tenant.id,
        type: 'contact_for',
        subject_id: b.person,
        subject_kind: 'person',
        object_id: b.organisation,
        object_kind: 'organisation',
      }),
    );

    await expect(
      inTenant(a, (tx) =>
        handlers.addRelationship({
          tx,
          context,
          input: {
            params: { organisationId: b.organisation },
            body: { type: 'contact_for', personId: a.person },
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inTenant(a, (tx) =>
        handlers.endRelationship({
          tx,
          context,
          input: { params: { relationshipId: foreign }, body: { endsOn: '2026-12-01' } },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(events).toEqual([]);
    const [row] = await asMigrator<{ ends_on: string | null }>(
      b,
      'SELECT ends_on FROM party.relationship WHERE id = $1',
      [foreign],
    );
    expect(row?.ends_on).toBeNull();
  });
});

describe('value history reads', () => {
  it('pages newest first, audits each read, and never serves another tenant', async () => {
    const { events, context } = request(a);
    const first = await inTenant(a, (tx) =>
      handlers.getOrganisationHistory({
        tx,
        context,
        input: { params: { organisationId: a.organisation }, query: {} },
      }),
    );

    expect(first.entries.length).toBeGreaterThan(5);
    const times = first.entries.map((entry) => entry.changedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(events).toEqual([
      { read: true, action: 'party.value_history.viewed', entityId: a.organisation },
    ]);

    const person = await inTenant(a, (tx) =>
      handlers.getPersonHistory({
        tx,
        context,
        input: { params: { personId: a.person }, query: {} },
      }),
    );
    expect(person.entries.map((entry) => entry.fieldId).sort()).toEqual([
      'person.given_name',
      'person.phone',
    ]);
    expect(events).toHaveLength(2);

    await expect(
      inTenant(a, (tx) =>
        handlers.getOrganisationHistory({
          tx,
          context,
          input: { params: { organisationId: b.organisation }, query: {} },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inTenant(a, (tx) =>
        handlers.getPersonHistory({
          tx,
          context,
          input: { params: { personId: a.organisation }, query: {} },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(events).toHaveLength(2);
  });

  it('continues from a cursor and refuses a cursor from nowhere', async () => {
    const heavy = await asMigratorIn(a.tenant.id, async (client) => {
      const id = await addOrganisation(client, a.tenant);
      for (let n = 0; n < 30; n += 1) {
        await client.query(
          `INSERT INTO party.value_history (tenant_id, party_id, party_kind, field_id, old_value, new_value)
           VALUES ($1, $2, 'organisation', 'organisation.website', $3, $4)`,
          [a.tenant.id, id, `https://old${n}.example.org`, `https://new${n}.example.org`],
        );
      }
      return id;
    });
    const { context } = request(a);
    const read = (cursor?: string) =>
      inTenant(a, (tx) =>
        handlers.getOrganisationHistory({
          tx,
          context,
          input: { params: { organisationId: heavy }, query: { cursor } },
        }),
      );

    const page = await read();
    expect(page.entries).toHaveLength(25);
    expect(page.nextCursor).not.toBeNull();
    const rest = await read(page.nextCursor ?? undefined);
    expect(rest.entries).toHaveLength(5);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...page.entries, ...rest.entries].map((entry) => entry.newValue)).size).toBe(
      30,
    );
    await expect(read('AAAAAAAAAAAAAAAAAAAAAA')).rejects.toMatchObject({ status: 404 });
  });

  it('uses only audit actions the contracts list', () => {
    expect(partyAuditActions).toEqual(
      expect.arrayContaining([
        'party.value_history.viewed',
        'party.identifier.added',
        'party.identifier.verified',
        'party.relationship.ended',
      ]),
    );
  });
});
