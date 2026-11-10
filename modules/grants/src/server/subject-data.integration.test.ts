// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's subject access contribution against the test database,
// as app_worker (the role the export job runs as) in a tenant's transaction:
// a person's applications with each answer under its stable field id and the
// class the pinned form version gives it, their decision emails, and the
// eligibility results, stage moves, file links, assignments, scores and
// decisions that join to their applications, nothing of anyone else, and
// nothing of another tenant. It reads the same with the module switched off.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import {
  addFile,
  applicationRow,
} from '../../../../packages/db/test/grants/application-fixtures.ts';
import {
  assignmentRow,
  reviewerRow,
  scoreRow,
} from '../../../../packages/db/test/grants/assessment-fixtures.ts';
import { addReleased, emailRow } from '../../../../packages/db/test/grants/decision-fixtures.ts';
import { addCriterion } from '../../../../packages/db/test/grants/fixtures.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import type { Tx } from './programme/tables.ts';
import { grantsSubjectData } from './subject-data.ts';

const FORM = {
  sections: [
    {
      id: 's_about',
      title: 'About the applicant',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Project name', classification: 'public' },
        {
          id: 'f_health',
          type: 'long_text',
          label: 'Any access needs',
          classification: 'special_category',
          audiences: 'aggregate_only',
        },
        { id: 'f_files', type: 'file', label: 'Supporting files' },
      ],
    },
  ],
};

interface Fixture {
  readonly tenant: TestTenant;
  readonly person: string;
  readonly bystander: string;
  readonly member: string;
  readonly applications: readonly string[];
  /** Ids of the rows that join to the person's applications, by table. */
  readonly joined: Readonly<Record<string, string>>;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const released = await addReleased(client, tenant);
    const { parts } = released;
    const form = await insertRow(client, 'grants.form_version', {
      tenant_id: tenant.id,
      round_id: parts.round,
      version: 2,
      status: 'published',
      definition: FORM,
      published_at: new Date(),
      published_by: parts.member,
    });
    const apply = (person: string, change: Record<string, unknown>) =>
      addOrganisation(client, tenant).then((organisation_id) =>
        insertRow(
          client,
          'grants.application',
          applicationRow(tenant, { ...parts, person }, { organisation_id, ...change }),
        ),
      );
    const bystander = await addPerson(client, tenant);
    const applications = [
      released.application,
      await apply(parts.person, {
        form_version_id: form,
        answers: JSON.stringify({
          f_name: 'Hall roof',
          f_health: 'Step-free access needed',
          f_files: [randomUUID()],
          f_removed: 'An answer the pinned version no longer asks',
        }),
      }),
      await apply(parts.person, { answers: JSON.stringify({ f_name: 'First draft' }) }),
    ];
    await apply(bystander, { form_version_id: form, answers: JSON.stringify({ f_name: 'Other' }) });
    await insertRow(
      client,
      'grants.decision_email',
      emailRow(tenant, released, { recipient_person_id: parts.person }),
    );
    const reviewer = await addMember(client, tenant, ['reviewer']);
    await insertRow(
      client,
      'grants.reviewer',
      reviewerRow(tenant, parts.round, reviewer, parts.member),
    );
    const criterion = await addCriterion(client, tenant, parts.stages[1], { position: 1 });
    const review = {
      parts,
      application: released.application,
      reviewer,
      criteria: [criterion, criterion, criterion],
    } as const;
    const assignment = await insertRow(client, 'grants.assignment', assignmentRow(tenant, review));
    const joined = {
      'grants.assignment': assignment,
      'grants.score': await insertRow(client, 'grants.score', scoreRow(tenant, review, assignment)),
      'grants.decision': released.decision,
      'grants.eligibility_result': await insertRow(client, 'grants.eligibility_result', {
        tenant_id: tenant.id,
        application_id: released.application,
        form_version_id: parts.formVersion,
        outcome: 'eligible',
        checked_by: parts.member,
      }),
      'grants.stage_transition': await insertRow(client, 'grants.stage_transition', {
        tenant_id: tenant.id,
        round_id: parts.round,
        application_id: released.application,
        to_stage_id: parts.stages[0],
        moved_by: parts.member,
      }),
      'grants.application_file': await insertRow(client, 'grants.application_file', {
        tenant_id: tenant.id,
        application_id: applications[1],
        file_id: await addFile(client, tenant, parts.member),
        field_id: 'f_files',
        created_by: parts.member,
      }),
    };
    return {
      tenant,
      person: parts.person,
      bystander,
      member: parts.member,
      applications,
      joined,
    };
  });
}

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_worker', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([addFixture(), addFixture()]);
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

const read = (tenant: TestTenant, subject: string) =>
  withTenant(db, trustedTenantId(tenant.id), (tx: Tx) =>
    grantsSubjectData.subjectData(tx, subject),
  );

describe('grantsSubjectData', { timeout: 30_000 }, () => {
  it("returns the person's applications with each answer by field id and class", async () => {
    const rows = (await read(a.tenant, a.person))['grants.application'] ?? [];
    expect(rows.map((row) => row['grants.application.id']?.value).sort()).toEqual(
      [...a.applications].sort(),
    );
    const pinned = rows.find((row) => 'f_health' in row);
    expect(pinned?.['f_name']).toEqual({ value: 'Hall roof', sensitivity: 'public' });
    expect(pinned?.['f_health']?.sensitivity).toBe('special_category');
    expect(pinned?.['f_files']?.value).toHaveLength(1);
    expect(pinned?.['grants.application.applicant_person_id']).toEqual({
      value: a.person,
      sensitivity: 'internal',
    });
  });

  it('leaves out an answer the pinned version does not ask, and the raw answers column', async () => {
    const rows = (await read(a.tenant, a.person))['grants.application'] ?? [];
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('f_removed');
      expect(Object.keys(row)).not.toContain('grants.application.answers');
    }
    expect(JSON.stringify(rows)).not.toContain('no longer asks');
  });

  it("returns the person's decision emails and no one else's applications", async () => {
    const data = await read(a.tenant, a.person);
    expect(data['grants.decision_email']).toHaveLength(1);
    const other = await read(a.tenant, a.bystander);
    expect(other['grants.application']).toHaveLength(1);
    expect(other['grants.decision_email']).toEqual([]);
  });

  it("returns every table that joins to the person's applications, with its classes", async () => {
    const data = await read(a.tenant, a.person);
    for (const [table, id] of Object.entries(a.joined)) {
      expect(
        data[table]?.map((row) => row[`${table}.id`]?.value),
        table,
      ).toEqual([id]);
    }
    expect(data['grants.score']?.[0]?.['grants.score.comment']).toEqual({
      value: 'Clear evidence that the hall is used every day.',
      sensitivity: 'personal',
    });
    expect(data['grants.decision']?.[0]?.['grants.decision.outcome']?.value).toBe('accepted');
  });

  it('returns none of those tables for a person with other applications only', async () => {
    const data = await read(a.tenant, a.bystander);
    for (const table of Object.keys(a.joined)) expect(data[table], table).toEqual([]);
  });

  it('reads the same when the tenant has switched grants off', async () => {
    await asMigratorIn(b.tenant.id, (client) =>
      insertRow(client, 'app.tenant_module', {
        tenant_id: b.tenant.id,
        module: 'grants',
        enabled: false,
        updated_by: b.member,
      }),
    );
    const data = await read(b.tenant, b.person);
    expect(data['grants.application']).toHaveLength(3);
    expect(data['grants.score']).toHaveLength(1);
  });

  it("returns nothing of another tenant's person, in either direction", async () => {
    for (const [tenant, stranger] of [
      [a.tenant, b.person],
      [b.tenant, a.person],
    ] as const) {
      const data = await read(tenant, stranger);
      for (const rows of Object.values(data)) expect(rows).toEqual([]);
    }
  });
});
