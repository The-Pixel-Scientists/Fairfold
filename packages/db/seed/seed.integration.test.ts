// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seed against the test database. `configured` is written under slugs,
// and so addresses, that no earlier run has used, and committed. Each row
// sits in its own tenant, out of sight of the other's app roles; each member
// has a verified account with an Argon2id password and no authenticator, a
// membership and a person; and Northfield's round is set up as configured,
// with its published form. `applications` adds applicants, their
// organisations and their applications, with each application's
// eligibility check and stage history, and the round's reviewer pool with
// its assignments and scores. A database that has had a tenant is refused.

import { randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../test/connect.ts';
import { asRoleIn, createTestTenant } from '../test/tenants.ts';
import { applications } from './applications.ts';
import { communitySpacesForm, configured } from './configured.ts';
import {
  applicantEmailOf,
  emailOf,
  writeScenario,
  type Scenario,
  type SeededTenant,
} from './scenario.ts';
import { checkNoTenants } from './seed.ts';

const PASSWORD = 'a long synthetic passphrase';

const TENANT_TABLES = [
  'app.tenant',
  'app.membership',
  'app.tenant_theme',
  'party.party',
  'party.person',
  'grants.programme',
  'grants.round',
  'grants.stage',
  'grants.rubric_criterion',
  'grants.email_template_version',
  'grants.form_version',
  'party.organisation',
  'party.relationship',
  'grants.application',
  'grants.eligibility_result',
  'grants.stage_transition',
  'grants.reviewer',
  'grants.assignment',
  'grants.score',
];

/** `scenario` under slugs no earlier run has used. */
function unused(scenario: Scenario): Scenario {
  const suffix = randomBytes(4).toString('hex');
  return scenario.map((tenant) => ({ ...tenant, slug: `${tenant.slug}-${suffix}` }));
}

/** Each tenant's app_api sees exactly its own rows of every tenant table. */
async function expectOwnRowsOnly(tenants: readonly SeededTenant[]): Promise<void> {
  const written = (table: string) => tenants.flatMap((tenant) => tenant.rows[table] ?? []);
  for (const tenant of tenants) {
    const seen = await asRoleIn('app_api', tenant.id, async (client) => {
      const found: Record<string, string[]> = {};
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`,
          [written(table)],
        );
        if (rows.length > 0) found[table] = rows.map(({ id }) => id).sort();
      }
      return found;
    });
    const own = Object.entries(tenant.rows)
      .filter(([table]) => TENANT_TABLES.includes(table))
      .map(([table, ids]) => [table, [...ids].sort()]);
    expect(seen).toEqual(Object.fromEntries(own));
  }
}

const counts = ({ rows }: SeededTenant) =>
  Object.fromEntries(Object.entries(rows).map(([table, ids]) => [table, ids.length]));

const scenario = unused(configured);
let northfield: SeededTenant;
let eastmoor: SeededTenant;

beforeAll(async () => {
  const seeded = await withClient('migrator', (client) =>
    writeScenario(client, scenario, PASSWORD),
  );
  [northfield, eastmoor] = seeded as [SeededTenant, SeededTenant];
});

describe('the configured scenario', { timeout: 60_000 }, () => {
  it('writes the rows each tenant needs', () => {
    const people = { 'auth.user': 4, 'auth.account': 4, 'app.membership': 4 };
    const persons = { 'party.party': 4, 'party.person': 4 };
    expect(counts(northfield)).toEqual({
      'app.tenant': 1,
      ...people,
      ...persons,
      'grants.programme': 1,
      'grants.email_template_version': 3,
      'grants.round': 1,
      'grants.stage': 3,
      'grants.rubric_criterion': 3,
      'grants.form_version': 1,
    });
    expect(counts(eastmoor)).toEqual({
      'app.tenant': 1,
      ...people,
      ...persons,
      'app.tenant_theme': 1,
    });
  });

  it('puts each row in its own tenant, where the other cannot see it', async () => {
    await expectOwnRowsOnly([northfield, eastmoor]);
  });

  it('gives each member a verified account with no authenticator, a membership and a person', async () => {
    for (const [index, tenant] of scenario.entries()) {
      const id = [northfield, eastmoor][index]?.id ?? '';
      const expected = tenant.staff
        .map((member) => ({
          email: emailOf(tenant, member),
          given_name: member[0],
          family_name: member[1],
          roles: [member[2]],
        }))
        .sort((a, b) => a.email.localeCompare(b.email));
      const members = await asRoleIn('app_api', id, async (client) => {
        const { rows } = await client.query<Record<string, unknown>>(
          `SELECT p.email, p.given_name, p.family_name, m.roles
             FROM party.person p JOIN app.membership m ON m.user_id = p.user_id
            WHERE m.status = 'active'
            ORDER BY p.email`,
        );
        return rows;
      });
      expect(members).toEqual(expected);

      const accounts = await withClient('migrator', async (client) => {
        const { rows } = await client.query<{ password: string } & Record<string, unknown>>(
          `SELECT u.email, u.name, u.email_verified, u.two_factor_enabled, u.status, a.password,
                  EXISTS (SELECT 1 FROM auth.two_factor f WHERE f.user_id = u.id) AS authenticator
             FROM auth."user" u JOIN auth.account a ON a.user_id = u.id
            WHERE u.email = ANY($1)
            ORDER BY u.email`,
          [expected.map(({ email }) => email)],
        );
        return rows;
      });
      expect(accounts).toEqual(
        expected.map(({ email, given_name, family_name }) => ({
          email,
          name: `${given_name} ${family_name}`,
          email_verified: true,
          two_factor_enabled: false,
          status: 'active',
          password: expect.stringMatching(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/) as unknown,
          authenticator: false,
        })),
      );
      expect(new Set(accounts.map(({ password }) => password)).size).toBe(accounts.length);
    }
  });

  it("sets up Northfield's open round, stages, rubric and templates, and Eastmoor's look", async () => {
    const programme = await asRoleIn('app_api', northfield.id, async (client) => {
      const query = async (text: string) =>
        (await client.query<Record<string, unknown>>(text)).rows;
      return {
        rounds: await query(
          `SELECT p.title AS programme, p.status, r.title, r.opens_at, r.closes_at, r.timezone,
                  r.budget_minor, r.award_min_minor, r.award_max_minor, r.currency, r.late_policy
             FROM grants.programme p JOIN grants.round r ON r.programme_id = p.id`,
        ),
        stages: await query('SELECT name FROM grants.stage ORDER BY position'),
        criteria: await query(
          `SELECT s.name AS stage, c.label, c.weight, c.scale_min, c.scale_max
             FROM grants.rubric_criterion c JOIN grants.stage s ON s.id = c.stage_id
            ORDER BY c.position`,
        ),
        templates: await query(
          'SELECT outcome, version FROM grants.email_template_version ORDER BY outcome',
        ),
        theme: await query('SELECT brand_colour FROM app.tenant_theme'),
        forms: await query(
          'SELECT version, status, published_at, definition FROM grants.form_version',
        ),
      };
    });
    expect(programme).toEqual({
      rounds: [
        {
          programme: 'Community Spaces Fund',
          status: 'open',
          title: 'Autumn 2026',
          // 9am BST and 5pm GMT: the clocks go back on 25 October.
          opens_at: new Date('2026-10-12T08:00:00Z'),
          closes_at: new Date('2026-11-02T17:00:00Z'),
          timezone: 'Europe/London',
          budget_minor: '15000000',
          award_min_minor: '500000',
          award_max_minor: '2500000',
          currency: 'GBP',
          late_policy: 'accept_and_flag',
        },
      ],
      stages: [{ name: 'Intake' }, { name: 'Review' }, { name: 'Decision' }],
      criteria: [
        { stage: 'Review', label: 'Need', weight: 3, scale_min: 1, scale_max: 5 },
        { stage: 'Review', label: 'Approach', weight: 2, scale_min: 1, scale_max: 5 },
        { stage: 'Review', label: 'Value for money', weight: 1, scale_min: 1, scale_max: 5 },
      ],
      templates: ['accepted', 'declined', 'waitlisted'].map((outcome) => ({ outcome, version: 1 })),
      theme: [],
      forms: [
        {
          version: 1,
          status: 'published',
          // The day before the round opens.
          published_at: new Date('2026-10-11T08:00:00Z'),
          // As parsed, with every default written out.
          definition: expect.objectContaining({
            sections: communitySpacesForm.sections.map(({ id }): unknown =>
              expect.objectContaining({ id, conditions: [] }),
            ),
          }) as unknown,
        },
      ],
    });

    const look = await asRoleIn('app_api', eastmoor.id, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        'SELECT brand_colour, preset FROM app.tenant_theme',
      );
      return rows;
    });
    expect(look).toEqual([{ brand_colour: '#0b6e4f', preset: 'rounded' }]);
  });
});

describe('the applications scenario', { timeout: 60_000 }, () => {
  const withApplications = unused(applications);
  const [tenant] = withApplications;
  let seeded: SeededTenant[];
  let tenantId: string;
  beforeAll(async () => {
    seeded = await withClient('migrator', (client) =>
      writeScenario(client, withApplications, PASSWORD),
    );
    tenantId = seeded[0]?.id ?? '';
  });

  it('writes six applicants, their groups and their applications, with checks and history', () => {
    expect(seeded[0] && counts(seeded[0])).toMatchObject({
      'auth.user': 10,
      'app.membership': 10,
      'party.party': 16,
      'party.person': 10,
      'party.organisation': 6,
      'party.relationship': 6,
      'grants.form_version': 1,
      'grants.application': 6,
      'grants.eligibility_result': 6,
      'grants.stage_transition': 10,
      'grants.reviewer': 2,
      'grants.assignment': 4,
      'grants.score': 6,
    });
  });

  it('puts each row in its own tenant, where the other cannot see it', async () => {
    await expectOwnRowsOnly(seeded);
  });

  it('makes each applicant a member with the applicant role and a contact for their group', async () => {
    const found = await asRoleIn('app_api', tenantId, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT p.email, m.roles, o.name AS organisation
           FROM grants.application a
           JOIN party.person p ON p.id = a.applicant_person_id
           JOIN app.membership m ON m.user_id = p.user_id
           JOIN party.relationship r
             ON r.subject_id = p.id AND r.object_id = a.organisation_id
            AND r.type = 'contact_for' AND r.ends_on IS NULL
           JOIN party.organisation o ON o.id = a.organisation_id
          ORDER BY p.email`,
      );
      return rows;
    });
    const expected = (tenant?.programmes?.[0]?.rounds[0]?.applications ?? [])
      .map(({ applicant, organisation }) => ({
        email: tenant ? applicantEmailOf(tenant, applicant) : '',
        roles: ['applicant'],
        organisation: organisation.name,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
    expect(found).toEqual(expected);
  });

  it('places the applications in their stages, with one late and one withdrawn', async () => {
    const found = await asRoleIn('app_api', tenantId, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT o.name, a.status, s.name AS stage, a.submitted_late AS late,
                a.form_version_id = f.id AS pinned, jsonb_typeof(a.answers->'f_budget') AS budget,
                (SELECT array_agg(e.outcome) FROM grants.eligibility_result e
                  WHERE e.application_id = a.id) AS checks,
                (SELECT array_agg(t.name ORDER BY m.moved_at)
                   FROM grants.stage_transition m JOIN grants.stage t ON t.id = m.to_stage_id
                  WHERE m.application_id = a.id) AS history
           FROM grants.application a
           JOIN party.organisation o ON o.id = a.organisation_id
           JOIN grants.stage s ON s.id = a.stage_id
           JOIN grants.form_version f ON f.round_id = a.round_id
          ORDER BY o.name`,
      );
      return rows;
    });
    const stages = ['Intake', 'Review', 'Decision'];
    const row = (name: string, status: string, stage: string, late = false) => ({
      name,
      status,
      stage,
      late,
      pinned: true,
      budget: 'array',
      checks: ['eligible'],
      history: stages.slice(0, stages.indexOf(stage) + 1),
    });
    expect(found).toEqual([
      row('Brook Street Youth Club', 'submitted', 'Intake', true),
      row('Friends of Elm Park', 'submitted', 'Decision'),
      row('Northfield Allotment Society', 'submitted', 'Review'),
      row('Northfield Repair Cafe', 'withdrawn', 'Intake'),
      row('Northfield Rovers Football Club', 'submitted', 'Review'),
      row('Westgate Village Hall', 'submitted', 'Intake'),
    ]);
  });

  it("assigns the pool's reviewers to the applications in Review, with draft and submitted scores", async () => {
    const found = await asRoleIn('app_api', tenantId, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT o.name, p.given_name AS reviewer, s.name AS stage, x.status,
                x.submitted_at IS NOT NULL AS submitted,
                (SELECT array_agg(sc.score ORDER BY c.position)
                   FROM grants.score sc JOIN grants.rubric_criterion c ON c.id = sc.criterion_id
                  WHERE sc.assignment_id = x.id) AS scores
           FROM grants.assignment x
           JOIN grants.reviewer r
             ON r.round_id = x.round_id AND r.membership_id = x.reviewer_membership_id
           JOIN app.membership m ON m.id = r.membership_id
           JOIN party.person p ON p.user_id = m.user_id
           JOIN grants.application a ON a.id = x.application_id
           JOIN party.organisation o ON o.id = a.organisation_id
           JOIN grants.stage s ON s.id = x.stage_id
          ORDER BY o.name, p.given_name`,
      );
      return rows;
    });
    const row = (name: string, reviewer: string, scores: number[] | null, submitted = false) => ({
      name,
      reviewer,
      stage: 'Review',
      status: submitted ? 'submitted' : 'assigned',
      submitted,
      scores,
    });
    expect(found).toEqual([
      row('Northfield Allotment Society', 'Owen', [4, 3, 4], true),
      row('Northfield Allotment Society', 'Priya', [5, 4]),
      row('Northfield Rovers Football Club', 'Owen', [4]),
      row('Northfield Rovers Football Club', 'Priya', null),
    ]);
  });
});

describe('checkNoTenants', () => {
  it('refuses a database that has had a tenant', async () => {
    await createTestTenant();
    await withClient('migrator', async (client) => {
      await expect(checkNoTenants(client, 'tps_w_test')).rejects.toThrow(
        'Refusing to seed tps_w_test: it already has tenants.',
      );
    });
  });
});
