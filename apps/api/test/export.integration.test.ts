// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The 360Giving export through the whole API against the test database, as
// app_api: the funder's publisher details with their configuration version
// and audit event, and a file of the released awards of one programme or
// round and no other decision. Only an administrator reaches either, within
// their own tenant, and each download is audited.

import { randomUUID } from 'node:crypto';

import {
  MAX_EXPORT_GRANTS,
  threeSixtyGivingFileSchema,
  type PublisherAnswer,
  type PublisherSetting,
  type ThreeSixtyGivingExport,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { accepted, declined, startDecisionsApi, waitlisted } from './decisions-api.ts';
import type { DecisionsApi } from './decisions-api.ts';
import { answer, programmeBody, roundBody, storedVersions, type Problem } from './programme-api.ts';
import { addMember, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const PUBLISHER = {
  funderIdentifier: 'GB-CHC-7654321',
  funderName: 'Northfield Foundation',
  identifierPrefix: '360G-northfield',
};
const PUBLISHER_PATH = '/console/exports/360giving/publisher';
const EXPORT_PATH = '/console/exports/360giving';

let t: DecisionsApi;
let adminB: Member;

beforeAll(async () => {
  t = await startDecisionsApi('41060');
  adminB = await addMember(t.tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const exported = (query: string, member: Member = t.adminA) =>
  t.send(member, 'GET', `${EXPORT_PATH}?${query}`);

const auditEvents = <T extends object = { changes: object }>(action: string, entityId: string) =>
  t.events<T>(action, [entityId]);

/** A round whose three submissions are decided and released, and a fourth recorded and not released. */
async function aReleasedRound() {
  const round = await t.reviewRound();
  const [a, b, c, d] = [
    await t.submission(round),
    await t.submission(round),
    await t.submission(round),
    await t.submission(round),
  ];
  await t.recorded(a, accepted(15_000));
  await t.recorded(b, waitlisted);
  await t.recorded(c, declined);
  await answer(t.release(round.open.round.id));
  await t.recorded(d, accepted(12_345));
  return { round, roundId: round.open.round.id, programmeId: round.open.programmeId, a, b, c, d };
}

describe('the funder details', () => {
  it('are missing until saved, and the export is refused with a plain problem', async () => {
    expect(await answer<PublisherAnswer>(t.send(t.adminA, 'GET', PUBLISHER_PATH))).toEqual({
      publisher: null,
    });
    const { roundId } = await aReleasedRound();

    const refused = await exported(`roundId=${roundId}`);

    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().detail).toMatch(/Save the funder's 360Giving details/);
    expect(await t.rows('SELECT 1 FROM grants.publisher_setting')).toEqual([]);
    expect(await auditEvents('grants.export.downloaded', roundId)).toEqual([]);
  });

  it('save with a configuration version and an audit event, and a repeat changes nothing', async () => {
    const saved = await answer<PublisherSetting>(
      t.send(t.adminA, 'PUT', PUBLISHER_PATH, PUBLISHER),
    );
    expect(saved).toMatchObject(PUBLISHER);
    const [row] = await t.rows<{ id: string }>('SELECT id FROM grants.publisher_setting');
    const id = row?.id ?? '';

    const versions = await storedVersions(t.tenantA, 'grants.publisher_setting', id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ author_id: t.adminA.membershipId });
    expect(versions[0]?.diff).toEqual({
      changes: [
        { path: 'funderIdentifier', from: null, to: PUBLISHER.funderIdentifier },
        { path: 'funderName', from: null, to: PUBLISHER.funderName },
        { path: 'identifierPrefix', from: null, to: PUBLISHER.identifierPrefix },
      ],
    });
    const [created] = await auditEvents<{ actor_id: string; changes: object }>(
      'grants.publisher_setting.changed',
      id,
    );
    expect(created?.actor_id).toBe(t.adminA.membershipId);
    expect(created?.changes).toMatchObject({
      'grants.publisher_setting.funder_name': { before: null, after: PUBLISHER.funderName },
    });

    await answer(t.send(t.adminA, 'PUT', PUBLISHER_PATH, PUBLISHER));
    expect(await storedVersions(t.tenantA, 'grants.publisher_setting', id)).toHaveLength(1);

    const renamed = { ...PUBLISHER, funderName: 'Northfield Trust' };
    await answer(t.send(t.adminA, 'PUT', PUBLISHER_PATH, renamed));
    expect(await storedVersions(t.tenantA, 'grants.publisher_setting', id)).toHaveLength(2);
    const events = await auditEvents<{ changes: object }>('grants.publisher_setting.changed', id);
    expect(events[1]?.changes).toEqual({
      'grants.publisher_setting.funder_name': {
        before: PUBLISHER.funderName,
        after: 'Northfield Trust',
      },
    });
    expect(await answer<PublisherAnswer>(t.send(t.adminA, 'GET', PUBLISHER_PATH))).toMatchObject({
      publisher: renamed,
    });
    await answer(t.send(t.adminA, 'PUT', PUBLISHER_PATH, PUBLISHER));
  });

  it('refuse a value the standard would not take, and a field the server owns', async () => {
    const bodies = [
      { ...PUBLISHER, funderIdentifier: 'not an identifier' },
      { ...PUBLISHER, identifierPrefix: 'northfield' },
      { ...PUBLISHER, funderName: '  ' },
      { ...PUBLISHER, funderName: 'Line\nbreak' },
      { ...PUBLISHER, tenantId: randomUUID() },
      { ...PUBLISHER, updatedBy: t.adminA.membershipId },
    ];
    for (const body of bodies) {
      expect((await t.send(t.adminA, 'PUT', PUBLISHER_PATH, body)).statusCode).toBe(400);
    }
    expect(await t.rows('SELECT 1 FROM grants.publisher_setting')).toHaveLength(1);
  });
});

describe('the export', () => {
  it('holds only accepted decisions that are released, for a round and for its programme', async () => {
    const { roundId, programmeId, a, b, c, d } = await aReleasedRound();

    const byRound = await answer<ThreeSixtyGivingExport>(exported(`roundId=${roundId}`));
    const byProgramme = await answer<ThreeSixtyGivingExport>(
      exported(`programmeId=${programmeId}`),
    );

    expect(byProgramme).toEqual(byRound);
    expect(byRound.summary.grants).toBe(1);
    expect(byRound.file.grants).toHaveLength(1);
    const [grant] = byRound.file.grants;
    expect(grant).toMatchObject({
      id: `${PUBLISHER.identifierPrefix}-${a}`,
      title: expect.any(String) as string,
      currency: 'GBP',
      amountAwarded: 15_000,
      recipientOrganization: [
        { id: 'GB-CHC-1234567', name: 'Northfield Allotment Society', charityNumber: '1234567' },
      ],
      fundingOrganization: [{ id: PUBLISHER.funderIdentifier, name: PUBLISHER.funderName }],
    });
    expect(grant?.awardDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(threeSixtyGivingFileSchema.safeParse(byRound.file).success).toBe(true);

    const text = JSON.stringify(byRound);
    for (const hidden of [
      b,
      c,
      d,
      '"amountAwarded":12345',
      'waitlist',
      'declined',
      '@example.org',
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it('names the recipients whose identifier no one has verified', async () => {
    const { roundId } = await aReleasedRound();
    const { summary } = await answer<ThreeSixtyGivingExport>(exported(`roundId=${roundId}`));
    expect(summary.grants).toBe(1);
    expect(summary.unverifiedRecipients).toEqual([
      { id: expect.any(String) as string, name: 'Northfield Allotment Society' },
    ]);
  });

  it('writes a hostile organisation name as text, escaped in the JSON', async () => {
    const { roundId, a } = await aReleasedRound();
    const name = `"}],"grants":[]}<script>alert('x')</script>\\`;
    await t.rows(
      `UPDATE party.organisation SET name = $2
         WHERE id = (SELECT organisation_id FROM grants.application WHERE id = $1)`,
      [a, name],
    );

    const response = await exported(`roundId=${roundId}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.body).toContain(JSON.stringify(name));
    const parsed = response.json<ThreeSixtyGivingExport>();
    expect(parsed.file.grants).toHaveLength(1);
    expect(parsed.file.grants[0]?.recipientOrganization[0]?.name).toBe(name);
  });

  it('records each download with the programme or round and the number of grants', async () => {
    const { roundId, programmeId } = await aReleasedRound();
    await answer(exported(`roundId=${roundId}`));
    await answer(exported(`programmeId=${programmeId}`));
    await answer(exported(`programmeId=${programmeId}`));

    const [first] = await auditEvents<{ actor_id: string; changes: object }>(
      'grants.export.downloaded',
      roundId,
    );
    expect(first).toMatchObject({
      actor_id: t.adminA.membershipId,
      changes: { 'grants.decision.id': { before: null, after: 1 } },
    });
    expect(await auditEvents('grants.export.downloaded', programmeId)).toHaveLength(2);
  });

  it('gives an empty file for a round with nothing released, and audits it', async () => {
    const round = await t.reviewRound();
    const roundId = round.open.round.id;
    await t.recorded(await t.submission(round), accepted(15_000));

    const { file, summary } = await answer<ThreeSixtyGivingExport>(exported(`roundId=${roundId}`));

    expect(file.grants).toEqual([]);
    expect(summary).toEqual({ grants: 0, unverifiedRecipients: [] });
    expect(await auditEvents('grants.export.downloaded', roundId)).toHaveLength(1);
  });

  it('needs a programme or a round, not both, and nothing else', async () => {
    const { roundId, programmeId } = await aReleasedRound();
    for (const query of [
      '',
      `roundId=${roundId}&programmeId=${programmeId}`,
      'roundId=not-an-id',
      `roundId=${roundId}&tenantId=${randomUUID()}`,
    ]) {
      expect((await exported(query)).statusCode, query).toBe(400);
    }
  });

  // Copying 5,000 awards runs per-row foreign keys and triggers: 30 to 60 s here, slower on a shared runner.
  it('exports up to the cap and asks the administrator to narrow past it', async () => {
    const { roundId, a } = await aReleasedRound();
    // Copies of the released award for new organisations, as the database holds them.
    const copyAwards = (count: number) =>
      asMigratorIn(t.tenantA.id, async (client) => {
        await client.query(
          `CREATE TEMP TABLE copies AS
             SELECT gen_random_uuid() AS organisation_id, gen_random_uuid() AS application_id,
                    gen_random_uuid() AS decision_id, n
               FROM generate_series(1, $1::int) n`,
          [count],
        );
        await client.query(
          `INSERT INTO party.party (tenant_id, id, kind)
             SELECT $1, organisation_id, 'organisation' FROM copies`,
          [t.tenantA.id],
        );
        const copy = (table: string, source: string, id: string, extra: string) =>
          client.query(
            `INSERT INTO ${table}
               SELECT (jsonb_populate_record(null::${table}, to_jsonb(s) || jsonb_build_object(
                        'id', c.${id}${extra})
                      )).*
                 FROM ${source} s CROSS JOIN copies c`,
          );
        await copy(
          'party.organisation',
          `(SELECT o.* FROM party.organisation o JOIN grants.application x ON x.organisation_id = o.id
             WHERE x.id = '${a}')`,
          'organisation_id',
          ", 'name', 'Copy ' || c.n",
        );
        await copy(
          'grants.application',
          `(SELECT * FROM grants.application WHERE id = '${a}')`,
          'application_id',
          ", 'organisation_id', c.organisation_id",
        );
        await copy(
          'grants.decision',
          `(SELECT * FROM grants.decision WHERE application_id = '${a}')`,
          'decision_id',
          ", 'application_id', c.application_id",
        );
        await client.query('DROP TABLE copies');
      });

    await copyAwards(MAX_EXPORT_GRANTS - 1);
    const full = await exported(`roundId=${roundId}`);
    expect(full.statusCode).toBe(200);
    expect(full.json<ThreeSixtyGivingExport>().summary.grants).toBe(MAX_EXPORT_GRANTS);

    await copyAwards(1);
    const over = await exported(`roundId=${roundId}`);
    expect(over.statusCode).toBe(400);
    expect(over.json<Problem>().detail).toMatch(/more than 5,000 grants/);
    expect(over.body).not.toContain('grants":[');
  }, 240_000);
});

describe('who may use the export routes', () => {
  it('refuses a programme manager, a reviewer, an applicant and a signed-out caller on every route', async () => {
    const { roundId } = await aReleasedRound();
    const routes: [Parameters<typeof t.send>[1], string, unknown][] = [
      ['GET', PUBLISHER_PATH, undefined],
      ['PUT', PUBLISHER_PATH, { ...PUBLISHER, funderName: 'Imposter' }],
      ['GET', `${EXPORT_PATH}?roundId=${roundId}`, undefined],
    ];
    const before = await t.rows('SELECT 1 FROM app.audit_event WHERE action = $1', [
      'grants.export.downloaded',
    ]);
    for (const [method, url, body] of routes) {
      for (const member of [t.managerA, t.reviewerA]) {
        const refused = await t.send(member, method, url, body);
        expect(refused.statusCode, `${method} ${url} as ${member.userId}`).toBe(403);
      }
      const applicant = await t.send(t.applicantA, method, url, body, 'portal');
      expect([401, 403, 404], `${method} ${url} as an applicant`).toContain(applicant.statusCode);
      expect((await t.send(undefined, method, url, body)).statusCode).toBe(401);
    }
    expect(
      await t.rows('SELECT 1 FROM app.audit_event WHERE action = $1', ['grants.export.downloaded']),
    ).toEqual(before);
    expect(await t.rows('SELECT funder_name FROM grants.publisher_setting')).toEqual([
      { funder_name: PUBLISHER.funderName },
    ]);
  });
});

describe('another tenant', () => {
  it("cannot export this tenant's programme or round, and the refusal reads as a missing one", async () => {
    const { roundId, programmeId } = await aReleasedRound();
    await answer(t.send(adminB, 'PUT', PUBLISHER_PATH, { ...PUBLISHER, funderName: 'Other Fund' }));
    const nothing = randomUUID();

    for (const query of [`roundId=${roundId}`, `programmeId=${programmeId}`]) {
      const outside = await exported(query, adminB);
      const missing = await exported(query.replace(/=.*/, `=${nothing}`), adminB);
      expectLooksMissing(outside, missing);
    }
    expect(await auditEvents('grants.export.downloaded', roundId)).toEqual([]);
  });

  it('keeps its own publisher details, and exports its own awards with them', async () => {
    expect(await answer<PublisherAnswer>(t.send(adminB, 'GET', PUBLISHER_PATH))).toMatchObject({
      publisher: { funderName: 'Other Fund' },
    });
    expect(await answer<PublisherAnswer>(t.send(t.adminA, 'GET', PUBLISHER_PATH))).toMatchObject({
      publisher: { funderName: PUBLISHER.funderName },
    });

    const programme = await answer<{ id: string }>(
      t.send(t.managerB, 'POST', '/console/programmes', programmeBody()),
      201,
    );
    await answer(
      t.send(t.managerB, 'POST', `/console/programmes/${programme.id}/rounds`, roundBody()),
      201,
    );
    const own = await answer<ThreeSixtyGivingExport>(
      exported(`programmeId=${programme.id}`, adminB),
    );
    expect(own.file.grants).toEqual([]);
  });
});
