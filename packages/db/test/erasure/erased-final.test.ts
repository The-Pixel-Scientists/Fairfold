// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An erased party's data is final (migration 0033, ADR 0027 "erased is
// final" and "Locks"): once erase_party commits, no role writes a person's
// or organisation's columns again, adds a row naming the party, gives it a
// live subject key, sends it a decision email, or writes its applicant's
// answers or a score comment about it. Workflow on the application, and its
// assessment, still run. party.is_erased() holds the party it reads, so an
// erasure waits for a write that has already checked.

import { randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { LoginRole } from '../../scripts/roles.ts';
import { withClient } from '../connect.ts';
import { addParts, applicationRow } from '../grants/application-fixtures.ts';
import { addAssignment, scoreRow, type Review } from '../grants/assessment-fixtures.ts';
import { addReleased, emailRow, type Released } from '../grants/decision-fixtures.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addErasureRequest, ERASE, erase } from './fixtures.ts';

let tenant: TestTenant;
let staff: string;
let person: string;
let organisation: string;
let live: string;
let application: string;
let round: string;
let formVersion: string;
let review: Review;
let assignment: string;
let score: string;
let released: Released;
let email: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const requests = await asMigratorIn(tenant.id, async (client) => {
    staff = await addMember(client, tenant);
    const parts = await addParts(client, tenant);
    ({ person, organisation, round, formVersion } = parts);
    live = await addOrganisation(client, tenant);
    application = await insertRow(client, 'grants.application', applicationRow(tenant, parts));
    await client.query('UPDATE grants.application SET answers = $2 WHERE id = $1', [
      application,
      JSON.stringify({ f_name: 'Ada' }),
    ]);
    ({ id: assignment, review } = await addAssignment(client, tenant));
    score = await insertRow(client, 'grants.score', scoreRow(tenant, review, assignment));
    released = await addReleased(client, tenant);
    email = await insertRow(client, 'grants.decision_email', emailRow(tenant, released));
    const erased = [person, organisation, review.parts.person, released.parts.person];
    const named: [string, string][] = [];
    for (const party of erased) {
      named.push([party, await addErasureRequest(client, tenant, staff, party)]);
    }
    return named;
  });
  for (const [party, request] of requests) {
    expect((await erase(tenant, party, request)).code).toBeUndefined();
  }
}, 60_000);

/** An insert of `row` into `table`, whose columns are the fixtures' own names. */
function insertInto(table: string, row: Row): readonly [string, unknown[]] {
  const columns = Object.keys(row);
  const parameters = columns.map((_, index) => `$${String(index + 1)}`);
  return [
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${parameters.join(', ')})`,
    Object.values(row),
  ];
}

/** Each write that would put an erased party's data back, and its parameters. */
const WRITES: Record<string, () => readonly [string, unknown[]]> = {
  'an erased person’s name and phone': () => [
    `UPDATE party.person SET given_name = 'Ada', family_name = 'Lovelace',
            phone = '+44 20 7946 0000' WHERE id = $1`,
    [person],
  ],
  'an erased organisation’s address': () => [
    `UPDATE party.organisation SET address_line1 = '1 High Street', address_town = 'Northfield',
            address_postcode = 'NF1 2AB', address_country_code = 'GB' WHERE id = $1`,
    [organisation],
  ],
  'value history of an erased person': () => [
    `INSERT INTO party.value_history (tenant_id, party_id, party_kind, field_id, new_value,
                                      changed_by)
     VALUES ($1, $2, 'person', 'person.given_name', 'Ada', $3)`,
    [tenant.id, person, staff],
  ],
  'a consent naming an erased person': () => [
    `INSERT INTO party.consent (tenant_id, person_id, purpose, channel, state,
                                privacy_notice_version, source, recorded_by)
     VALUES ($1, $2, 'future_funding', 'email', 'given', 'v1', 'staff', $3)`,
    [tenant.id, person, staff],
  ],
  'a relationship naming an erased person': () => [
    `INSERT INTO party.relationship (tenant_id, type, subject_id, subject_kind, object_id,
                                     object_kind, created_by, updated_by)
     VALUES ($1, 'contact_for', $2, 'person', $3, 'organisation', $4, $4)`,
    [tenant.id, person, live, staff],
  ],
  'an identifier of an erased organisation': () => [
    `INSERT INTO party.organisation_identifier (tenant_id, organisation_id, scheme, identifier,
                                                created_by, updated_by)
     VALUES ($1, $2, 'GB-CHC', '1234567', $3, $3)`,
    [tenant.id, organisation, staff],
  ],
  'a snapshot of an erased organisation': () => [
    'INSERT INTO party.organisation_snapshot (organisation_id, taken_by) VALUES ($1, $2)',
    [organisation, staff],
  ],
  'a subject key for an erased party': () => [
    `INSERT INTO app.subject_key (tenant_id, subject_party_id, wrapped_key, kek_version)
     VALUES ($1, $2, $3, 1)`,
    [tenant.id, person, randomBytes(60)],
  ],
  'an erased applicant’s answers': () => [
    `UPDATE grants.application SET answers = '{"f_name": "Ada Lovelace"}' WHERE id = $1`,
    [application],
  ],
  'a comment on an erased applicant’s score': () => [
    "UPDATE grants.score SET comment = 'Ada Lovelace runs the hall.' WHERE id = $1",
    [score],
  ],
  'a new score comment about an erased applicant': () =>
    insertInto(
      'grants.score',
      scoreRow(tenant, review, assignment, { criterion_id: review.criteria[1] }),
    ),
  'a decision email to an erased person': () =>
    insertInto('grants.decision_email', emailRow(tenant, released)),
  'an application naming an erased person': () => [
    `INSERT INTO grants.application (tenant_id, round_id, form_version_id, applicant_person_id,
                                     organisation_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [tenant.id, round, formVersion, person, live, staff],
  ],
};

/** The writes app_worker holds a right for; it lacks one for the rest. */
const WORKER_MAY = new Set(['a subject key for an erased party']);

describe('an erased party’s data', { timeout: 30_000 }, () => {
  it.each(Object.entries(WRITES))('refuses %s, whoever asks', async (name, write) => {
    const [text, values] = write();
    const expected: [LoginRole, string][] = [
      ['app_api', '55000'],
      ['app_worker', WORKER_MAY.has(name) ? '55000' : '42501'],
      // The table owner holds every right, so only the guard refuses it.
      ['migrator', '55000'],
    ];
    for (const [role, code] of expected) {
      await asRoleIn(role, tenant.id, async (client) => {
        expect(await outcome(client, text, values), role).toBe(code);
      });
    }
  });

  it('still lets the application’s workflow and a live party’s writes through', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const touch = 'UPDATE grants.application SET updated_by = $2 WHERE id = $1';
      expect(await outcome(client, touch, [application, staff])).toBe('ok');
      const rescore = 'UPDATE grants.score SET score = 7, comment = comment WHERE id = $1';
      expect(await outcome(client, rescore, [score])).toBe('ok');
      const uncomment = "UPDATE grants.score SET comment = '' WHERE id = $1";
      expect(await outcome(client, uncomment, [score])).toBe('ok');
      const [text, values] = insertInto(
        'grants.score',
        scoreRow(tenant, review, assignment, { criterion_id: review.criteria[1], comment: '' }),
      );
      expect(await outcome(client, text, values)).toBe('ok');
      const failed =
        "UPDATE grants.decision_email SET status = 'failed', error_code = 'no_address' WHERE id = $1";
      expect(await outcome(client, failed, [email])).toBe('ok');
      const address = "UPDATE party.organisation SET address_town = 'Southfield' WHERE id = $1";
      expect(await outcome(client, address, [live])).toBe('ok');
    });
  });
});

describe('party.is_erased', { timeout: 30_000 }, () => {
  const IS_ERASED = 'SELECT party.is_erased($1, $2) AS erased';

  it('reads the status, and false for a null id', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const read = async (party: string | null) =>
        (await client.query<{ erased: boolean }>(IS_ERASED, [tenant.id, party])).rows[0]?.erased;
      expect(await read(person)).toBe(true);
      expect(await read(live)).toBe(false);
      expect(await read(null)).toBe(false);
    });
  });

  it.each(['app_auth', 'app_queue'] as const)('cannot be called by %s', async (role) => {
    await asRoleIn(role, tenant.id, async (client) => {
      expect(await outcome(client, IS_ERASED, [tenant.id, person])).toBe('42501');
    });
  });

  it('holds the party, so an erasure waits for the write that checked it', async () => {
    const target = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
    const request = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, staff, target),
    );
    await asRoleIn('app_api', tenant.id, async (writer) => {
      await writer.query(IS_ERASED, [tenant.id, target]);
      const code = await withClient('app_worker', async (worker) => {
        await worker.query('BEGIN');
        try {
          await worker.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
            tenant.id,
          ]);
          await worker.query("SET LOCAL lock_timeout = '200ms'");
          return await outcome(worker, ERASE, [target, request]);
        } finally {
          await worker.query('ROLLBACK');
        }
      });
      expect(code).toBe('55P03');
    });
  });
});
