// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The organisation's details as submitted (ADR 0017), through the whole API
// against the test database, as app_api: one snapshot per submission, written
// in the submit transaction, fixed once taken, and left out of every refusal.

import { randomInt, randomUUID } from 'node:crypto';

import type { Application } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { complete, startApplicationsApi, type ApplicationsApi } from './applications-api.ts';
import { answer } from './programme-api.ts';
import { events } from './settings-api.ts';

vi.setConfig({ testTimeout: 30_000 });

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi('41035');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const NAME = 'Snapshot Society ZQ';
const PAST = "closes_at = now() - interval '1 hour'";

const snapshotOf = async (applicationId: string) =>
  (
    await t.rows<{ id: string | null }>(
      'SELECT organisation_snapshot_id AS id FROM grants.application WHERE id = $1',
      [applicationId],
    )
  )[0]?.id ?? null;

const snapshotsOf = (organisationId: string) =>
  t.rows<{ id: string }>('SELECT id FROM party.organisation_snapshot WHERE organisation_id = $1', [
    organisationId,
  ]);

/** The snapshot as stored, without its own id. */
const copy = async (snapshotId: string | null) =>
  (
    await t.rows<{ copy: object }>(
      `SELECT to_jsonb(s) - 'id' AS copy FROM party.organisation_snapshot s WHERE id = $1`,
      [snapshotId],
    )
  )[0]?.copy;

const startFor = async (roundId: string, organisationId: string) => {
  const draft = await answer<Application>(
    t.send(t.ann, 'POST', t.startPath(roundId), { organisationId }),
    201,
  );
  return t.saved(t.ann, draft, complete);
};

/** A draft of a new organisation in a new round, with complete answers saved. */
async function ready(roundChange: object = {}) {
  const open = await t.openRound(t.managerA, undefined, { round: roundChange });
  const organisationId = await t.organisationOf(t.ann, NAME);
  return { open, organisationId, saved: await startFor(open.round.id, organisationId) };
}

const editOrganisation = (organisationId: string) =>
  asMigratorIn(t.tenantA.id, async (client) => {
    await client.query(
      `UPDATE party.organisation
          SET name = 'Renamed Society', legal_form = 'other', address_line1 = '9 Low Road',
              address_town = 'Southfield', address_postcode = 'SF9 8ZZ',
              website = 'https://renamed.example.org'
        WHERE id = $1`,
      [organisationId],
    );
    // A new number first (it drops any verification), then a staff member's check of it.
    await client.query(
      'UPDATE party.organisation_identifier SET identifier = $2 WHERE organisation_id = $1',
      [organisationId, String(randomInt(1_000_000, 9_999_999))],
    );
    await client.query(
      `UPDATE party.organisation_identifier SET verified_at = now(), verified_by = $2
        WHERE organisation_id = $1`,
      [organisationId, t.managerA.membershipId],
    );
    await client.query(
      `INSERT INTO party.organisation_identifier (tenant_id, organisation_id, scheme, identifier)
       VALUES ($1, $2, 'GB-COH', '01234567')`,
      [t.tenantA.id, organisationId],
    );
  });

describe('submitting', () => {
  it('records the organisation as it stands, for the application, by the submitting member', async () => {
    const { organisationId, saved } = await ready();
    await answer(t.submit(t.ann, saved));

    const snapshotId = await snapshotOf(saved.id);
    expect(snapshotId).not.toBeNull();
    expect(await snapshotsOf(organisationId)).toEqual([{ id: snapshotId }]);
    expect(await copy(snapshotId)).toMatchObject({
      name: NAME,
      organisation_id: organisationId,
      taken_by: t.ann.membershipId,
      address_line1: '1 High Street',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1234567', verifiedAt: null }],
    });
  });

  it('audits the snapshot with ids and field ids only, about the organisation', async () => {
    const { organisationId, saved } = await ready();
    await answer(t.submit(t.ann, saved));
    const snapshotId = (await snapshotOf(saved.id)) ?? '';

    const [event] = (await events(t.tenantA, 'party.organisation_snapshot.created')).filter(
      ({ entity_id }) => entity_id === snapshotId,
    );
    expect(event?.actor_id).toBe(t.ann.membershipId);
    expect(event?.changes).toEqual({
      'party.organisation_snapshot.id': { after: snapshotId },
      'party.organisation_snapshot.organisation_id': { after: organisationId },
    });
    expect(JSON.stringify(event)).not.toMatch(/Snapshot Society|High Street|1234567|NF1/);
    const [subject] = await t.rows<{ subject: string }>(
      `SELECT subject_party_id AS subject FROM app.audit_event
        WHERE action = 'party.organisation_snapshot.created' AND entity_id = $1`,
      [snapshotId],
    );
    expect(subject?.subject).toBe(organisationId);
  });

  it('keeps the values of the moment, whatever the organisation becomes', async () => {
    const { organisationId, saved } = await ready();
    await answer(t.submit(t.ann, saved));
    const snapshotId = await snapshotOf(saved.id);
    const before = await copy(snapshotId);

    await editOrganisation(organisationId);

    expect(await copy(snapshotId)).toEqual(before);
    const [now] = await t.rows<{ name: string }>(
      'SELECT name FROM party.organisation WHERE id = $1',
      [organisationId],
    );
    expect(now?.name).toBe('Renamed Society');
  });

  it('gives two applications of one organisation the values of their own moments', async () => {
    const first = await ready();
    await answer(t.submit(t.ann, first.saved));
    await editOrganisation(first.organisationId);
    const second = await startFor((await t.openRound()).round.id, first.organisationId);
    await answer(t.submit(t.ann, second));

    const [one, two] = [await snapshotOf(first.saved.id), await snapshotOf(second.id)];
    expect(one).not.toBe(two);
    expect(await copy(one)).toMatchObject({
      name: NAME,
      legal_form: 'community_benefit_society',
    });
    expect(await copy(two)).toMatchObject({
      name: 'Renamed Society',
      website: 'https://renamed.example.org',
    });
    const identifiers = (await copy(two)) as { identifiers: { verifiedAt: string | null }[] };
    expect(identifiers.identifiers.map(({ verifiedAt }) => verifiedAt !== null)).toEqual([
      true,
      false,
    ]);
  });

  it('takes one for a late submission that is accepted, and no second for a repeat', async () => {
    const { open, organisationId, saved } = await ready({ latePolicy: 'accept_and_flag' });
    await t.changeRound(open.round.id, PAST);
    await answer(t.submit(t.ann, saved));
    expect((await t.submit(t.ann, saved)).statusCode).toBe(409);
    expect(await snapshotsOf(organisationId)).toHaveLength(1);
  });

  it('takes none, and audits none, when the submission is refused', async () => {
    const ineligible = await ready();
    const stopped = await t.saved(t.ann, ineligible.saved, { ...complete, f_charity: false });
    const invalid = await ready();
    const incomplete = await t.saved(t.ann, invalid.saved, { f_charity: true });
    const closed = await ready();
    await t.changeRound(closed.open.round.id, PAST);
    const before = (await events(t.tenantA, 'party.organisation_snapshot.created')).length;

    for (const application of [stopped, incomplete, closed.saved]) {
      expect((await t.submit(t.ann, application)).statusCode).toBe(400);
    }
    for (const { organisationId, saved } of [ineligible, invalid, closed]) {
      expect(await snapshotsOf(organisationId)).toEqual([]);
      expect(await snapshotOf(saved.id)).toBeNull();
    }
    expect(await events(t.tenantA, 'party.organisation_snapshot.created')).toHaveLength(before);
  });

  it('rolls the snapshot and its audit event back with a submission that fails after them', async () => {
    const { organisationId, saved } = await ready();
    const name = `fail_${randomUUID().replaceAll('-', '')}`;
    const run = (sql: string) =>
      asMigratorIn(t.tenantA.id, (client) => client.query(sql).then(() => undefined));
    await run(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$`);
    await run(`CREATE TRIGGER ${name} BEFORE INSERT ON grants.stage_transition
      FOR EACH ROW WHEN (NEW.application_id = '${saved.id}') EXECUTE FUNCTION public.${name}()`);
    try {
      const response = await t.submit(t.ann, saved);
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('forced failure');
    } finally {
      await run(`DROP TRIGGER ${name} ON grants.stage_transition`);
      await run(`DROP FUNCTION public.${name}()`);
    }

    expect(await snapshotsOf(organisationId)).toEqual([]);
    expect(await snapshotOf(saved.id)).toBeNull();
    const [row] = await t.rows<{ status: string }>(
      'SELECT status FROM grants.application WHERE id = $1',
      [saved.id],
    );
    expect(row?.status).toBe('draft');
    expect(
      await t.rows(
        `SELECT 1 FROM app.audit_event
          WHERE action = 'party.organisation_snapshot.created' AND changes::text LIKE $1`,
        [`%${organisationId}%`],
      ),
    ).toEqual([]);
  });
});

describe('across tenants', () => {
  it('lets no other tenant’s member submit the application or leave a snapshot', async () => {
    const { organisationId, saved } = await ready();
    expect((await t.submit(t.cat, saved)).statusCode).toBe(404);
    expect(await snapshotsOf(organisationId)).toEqual([]);
    expect(await snapshotOf(saved.id)).toBeNull();
  });
});
