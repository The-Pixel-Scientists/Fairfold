// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The search route through the whole API against the test database, as
// app_api: sessions, the policy, row-level security, the provider and the
// audit log, for two tenants holding the same names. Names and emails are
// invented. The term must come back nowhere: not in a log line, a problem
// body or an audit row.

import type { SearchResponse } from '@pixel-scientists/domain/platform/search';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOrganisation, addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { captureLogs, smtpTestSettings, testAuth, testSession } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { composeModules } from '../../modules.ts';

interface Member {
  readonly userId: string;
  readonly tenant: TestTenant;
  readonly app: 'console' | 'portal';
}

const logs = captureLogs();
const auth = testAuth();
let api: FastifyInstance;
let database: ApiDatabase;

let tenantA: TestTenant;
let tenantB: TestTenant;
let managerA: Member;
let reviewerA: Member;
let leadA: Member;
let applicantA: Member;
let managerB: Member;

const TERM = 'Quillfeather';
const personEmail = 'zelda.quillfeather@example.test';
const same = { given_name: 'Zelda', family_name: 'Quillfeather', email: personEmail };
const ids = {} as Record<'orgA' | 'orgB' | 'personA' | 'personB', string>;

async function addMember(
  tenant: TestTenant,
  app: 'console' | 'portal',
  role: string,
): Promise<Member> {
  const userId = await createTestUser();
  await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles: [role] }),
  );
  return { userId, tenant, app };
}

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41031',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'info', destination: logs.stream });
  database = openDatabase(settings, logger);

  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  managerA = await addMember(tenantA, 'console', 'programme_manager');
  reviewerA = await addMember(tenantA, 'console', 'reviewer');
  leadA = await addMember(tenantA, 'console', 'data_protection_lead');
  applicantA = await addMember(tenantA, 'portal', 'applicant');
  managerB = await addMember(tenantB, 'console', 'programme_manager');

  const seed = (tenant: TestTenant) =>
    asMigratorIn(tenant.id, async (client) => ({
      org: await addOrganisation(client, tenant, { name: 'Quillfeather Trust' }),
      person: await addPerson(client, tenant, same),
    }));
  const [a, b] = [await seed(tenantA), await seed(tenantB)];
  Object.assign(ids, { orgA: a.org, personA: a.person, orgB: b.org, personB: b.person });

  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    ...composeModules({ publicTenants: database.publicTenants }),
  });
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

const search = (member: Member | undefined, payload: unknown, url = '/api/console/search') =>
  api.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers:
      member === undefined
        ? {}
        : auth.as({
            app: member.app,
            session: testSession({
              app: member.app,
              userId: member.userId,
              tenant: member.tenant.id,
            }),
          }),
  });

async function found(member: Member, payload: unknown): Promise<SearchResponse> {
  const response = await search(member, payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<SearchResponse>();
}

const resultIds = (answer: SearchResponse): string[] =>
  answer.groups.flatMap((group) => group.results.map((result) => result.id));

const rows = <T extends object>(tenant: TestTenant, text: string) =>
  asMigratorIn(tenant.id, async (client) => (await client.query<T>(text)).rows);

describe('who may search', () => {
  it('lets a holder of platform.search.use in, and refuses the rest', async () => {
    expect((await search(managerA, { term: TERM })).statusCode).toBe(200);
    expect((await search(reviewerA, { term: TERM })).statusCode).toBe(200);
    expect((await search(leadA, { term: TERM })).statusCode).toBe(403);
    expect((await search(applicantA, { term: TERM })).statusCode).toBe(403);
    expect((await search(undefined, { term: TERM })).statusCode).toBe(401);
  });

  it('gives a reviewer no party results, as they do not hold party.records.read', async () => {
    expect(await found(reviewerA, { term: TERM })).toEqual({ audience: 'staff', groups: [] });
  });

  it('reads no query string: a term sent in one is refused, and not echoed', async () => {
    const answer = await search(managerA, { term: 'Marrowby' }, `/api/console/search?term=${TERM}`);
    expect(answer.statusCode).toBe(400);
    expect(answer.body.toLowerCase()).not.toContain(TERM.toLowerCase());
  });
});

describe('what a search finds', () => {
  it('returns the tenant’s organisation and person as ids and labels, grouped by module', async () => {
    const answer = await found(managerA, { term: TERM });
    expect(answer).toEqual({
      audience: 'staff',
      groups: [
        {
          module: 'party',
          results: [
            { kind: 'party.organisation', id: ids.orgA, label: 'Quillfeather Trust' },
            { kind: 'party.person', id: ids.personA, label: 'Zelda Quillfeather' },
          ],
          more: false,
        },
      ],
    });
  });

  it('never returns the other tenant’s rows, which hold the same names and email', async () => {
    const mine = resultIds(await found(managerA, { term: TERM }));
    const theirs = resultIds(await found(managerB, { term: TERM }));
    expect(mine).toEqual([ids.orgA, ids.personA]);
    expect(theirs).toEqual([ids.orgB, ids.personB]);
    expect(resultIds(await found(managerB, { term: 'zelda.quillfeather@' }))).toEqual([
      ids.personB,
    ]);
  });

  it('narrows to the modules named, and answers nothing for one that is not available', async () => {
    expect(resultIds(await found(managerA, { term: TERM, modules: ['party'] }))).toHaveLength(2);
    expect(await found(managerA, { term: TERM, modules: ['grants'] })).toEqual({
      audience: 'staff',
      groups: [],
    });
  });

  it('answers 200 with a person whose name or email is longer than a label may be', async () => {
    const [named, mailed] = await asMigratorIn(tenantA.id, async (client) => [
      await addPerson(client, tenantA, {
        given_name: `Ottery${'a'.repeat(94)}`,
        family_name: `Longlabel${'b'.repeat(91)}`,
      }),
      await addPerson(client, tenantA, { email: `longlabel${'c'.repeat(200)}@example.test` }),
    ]);
    const answer = await found(managerA, { term: 'longlabel' });
    expect(resultIds(answer)).toEqual(expect.arrayContaining([named, mailed]));
    const labels = answer.groups.flatMap((group) =>
      group.results.flatMap((result) => ('label' in result ? [result.label] : [])),
    );
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...labels.map((label) => label.length))).toBeLessThanOrEqual(200);
  });

  it('changes no party row', async () => {
    const count = () =>
      rows<{ n: string }>(
        tenantA,
        `SELECT (SELECT count(*) FROM party.party) + (SELECT count(*) FROM party.person)
              + (SELECT count(*) FROM party.organisation) AS n`,
      );
    const before = await count();
    await found(managerA, { term: TERM });
    expect(await count()).toEqual(before);
  });
});

describe('what a search writes', () => {
  it('records one person viewed event for each person returned, with ids and no term', async () => {
    const viewed = () =>
      rows<{ action: string; entity_id: string; subject_party_id: string | null }>(
        tenantA,
        `SELECT action, entity_id, subject_party_id FROM app.audit_event
          WHERE action = 'party.person.viewed' ORDER BY occurred_at, id`,
      );
    const before = (await viewed()).length;
    await found(managerA, { term: TERM });
    expect((await viewed()).slice(before)).toEqual([
      { action: 'party.person.viewed', entity_id: ids.personA, subject_party_id: ids.personA },
    ]);
  });

  it('writes no event for a search that finds nobody', async () => {
    const count = async () =>
      (await rows<{ n: string }>(tenantA, 'SELECT count(*) AS n FROM app.audit_event'))[0]?.n;
    const before = await count();
    await found(managerA, { term: 'Nobody Atall' });
    expect(await count()).toBe(before);
  });
});

describe('the term', () => {
  const tooShort = { term: 'Q' };
  const hidden = { term: `Zelda\u0000${TERM}` };

  it('is refused when too short, hidden or sent with other keys, without being echoed', async () => {
    for (const payload of [tooShort, hidden, { term: TERM, extra: TERM }, { modules: ['party'] }]) {
      const response = await search(managerA, payload);
      expect(response.statusCode).toBe(400);
      expect(response.body.toLowerCase()).not.toContain(TERM.toLowerCase());
    }
  });

  it('appears in no log line, problem body or audit row, whether it succeeds or is refused', async () => {
    const bodies = [
      (await search(managerA, { term: TERM })).body,
      (await search(managerA, tooShort)).body,
      (await search(managerA, hidden)).body,
      (await search(leadA, { term: TERM })).body,
      (await search(undefined, { term: TERM })).body,
    ];
    // The success body names the party, by design; every refusal must not.
    for (const body of bodies.slice(1)) expect(body.toLowerCase()).not.toContain('quillfeather');

    const text = logs.text().toLowerCase();
    expect(logs.lines().length).toBeGreaterThan(0);
    for (const secret of [TERM, 'zelda', personEmail]) {
      expect(text).not.toContain(secret.toLowerCase());
    }

    const events = await rows(tenantA, 'SELECT * FROM app.audit_event');
    expect(JSON.stringify(events).toLowerCase()).not.toContain(TERM.toLowerCase());
  });
});
