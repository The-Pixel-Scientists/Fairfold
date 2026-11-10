// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the tenant holds about one person, collected from every module and
// the platform in the caller's transaction against the test database, as
// app_worker (the role the export job runs as): the export file it makes, its
// class, a merged duplicate's rows, the audit events about the person or
// done by their memberships, the memberships and what they made, nothing of
// another tenant, and the time it takes for a person with 20 applications of
// 50 answers each.

import { randomBytes, randomUUID } from 'node:crypto';

import { subjectAccessExportSchema } from '@pixel-scientists/domain/platform/subject-access';
import { grantsSubjectData } from '@pixel-scientists/grants/server';
import { partyMergeSet, partySubjectData } from '@pixel-scientists/party/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import {
  addFile,
  addParts,
  applicationRow,
} from '../../../../../packages/db/test/grants/application-fixtures.ts';
import { addOrganisation, addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { collectSubjectAccess } from './collect.ts';
import { exportChunks, outputSensitivity } from './export-file.ts';

const QUESTIONS = 49;
const APPLICATIONS = 20;
const contributions = [partySubjectData, grantsSubjectData];

const FORM = {
  sections: [
    {
      id: 's_about',
      title: 'About the project',
      fields: [
        ...Array.from({ length: QUESTIONS }, (_, index) => ({
          id: `f_q${String(index)}`,
          type: 'short_text',
          label: `Question ${String(index)}`,
          classification: index === 0 ? 'special_category' : 'internal',
          ...(index === 0 ? { audiences: 'aggregate_only' } : {}),
        })),
        { id: 'f_files', type: 'file', label: 'Supporting files' },
      ],
    },
  ],
};

interface Fixture {
  readonly tenant: TestTenant;
  readonly person: string;
  readonly duplicate: string;
  readonly bystander: string;
  readonly membership: string;
  readonly staff: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  const userId = await createTestUser();
  return asMigratorIn(tenant.id, async (client) => {
    const parts = await addParts(client, tenant);
    const staff = await insertRow(client, 'app.membership', {
      tenant_id: tenant.id,
      user_id: await createTestUser(),
      roles: ['tenant_admin'],
    });
    const membership = await insertRow(client, 'app.membership', {
      tenant_id: tenant.id,
      user_id: userId,
      roles: ['applicant'],
    });
    await client.query('UPDATE party.person SET user_id = $2 WHERE id = $1', [
      parts.person,
      userId,
    ]);
    const form = await insertRow(client, 'grants.form_version', {
      tenant_id: tenant.id,
      round_id: parts.round,
      version: 2,
      status: 'published',
      definition: FORM,
      published_at: new Date(),
      published_by: parts.member,
    });
    const answers: Record<string, unknown> = { f_files: [randomUUID()] };
    for (let index = 0; index < QUESTIONS; index++) {
      answers[`f_q${String(index)}`] = `Answer ${String(index)}`;
    }
    for (let index = 0; index < APPLICATIONS; index++) {
      await insertRow(
        client,
        'grants.application',
        applicationRow(tenant, parts, {
          form_version_id: form,
          organisation_id: await addOrganisation(client, tenant),
          answers: JSON.stringify(answers),
        }),
      );
    }
    const duplicate = await addPerson(client, tenant, { given_name: 'Augusta' });
    await insertRow(client, 'party.consent', {
      tenant_id: tenant.id,
      person_id: duplicate,
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacy_notice_version: '2026-09',
      source: 'portal',
      recorded_by: staff,
    });
    await client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
      duplicate,
      parts.person,
    ]);
    const bystander = await addPerson(client, tenant);
    const audit = (actor: string | null, subject: string | null, entity = parts.person) =>
      insertRow(client, 'app.audit_event', {
        tenant_id: tenant.id,
        request_id: randomUUID(),
        actor_kind: actor === null ? 'system' : 'user',
        actor_id: actor,
        action: 'party.person.updated',
        entity_type: 'party.person',
        entity_id: entity,
        changes: { 'party.person.given_name': {} },
        subject_party_id: subject,
      });
    await audit(membership, parts.person);
    await audit(staff, parts.person);
    await audit(null, parts.person);
    // About the duplicate under its old id; by the person's membership about no one; by staff about someone else.
    await audit(null, duplicate, duplicate);
    await audit(membership, null, bystander);
    await audit(staff, bystander, bystander);
    await addFile(client, tenant, membership);
    const invitation = await insertRow(client, 'app.invitation', {
      tenant_id: tenant.id,
      email: `${randomUUID()}@example.test`,
      roles: ['reviewer'],
      token_hash: randomBytes(32),
    });
    await client.query(
      "UPDATE app.invitation SET status = 'accepted', accepted_membership_id = $2, updated_by = $2 WHERE id = $1",
      [invitation, membership],
    );
    await insertRow(client, 'app.job_request', {
      tenant_id: tenant.id,
      kind: 'subject_access',
      requested_by: membership,
      permission: 'platform.subject_access.request',
      filters: JSON.stringify({ partyId: bystander }),
      field_ids: ['party.person.given_name'],
      output_sensitivity: 'personal',
      request_id: randomUUID(),
    });
    return { tenant, person: parts.person, duplicate, bystander, membership, staff };
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
}, 120_000);

afterAll(async () => {
  await db.destroy();
});

const collect = (tenant: TestTenant, subject: string) =>
  withTenant(db, trustedTenantId(tenant.id), (tx) =>
    collectSubjectAccess(tx, contributions, partyMergeSet, subject),
  );

describe('collectSubjectAccess', { timeout: 60_000 }, () => {
  it('makes a valid export of 20 applications with 50 answers each, and reports the time', async () => {
    const started = performance.now();
    const data = await collect(a.tenant, a.person);
    let text = '';
    for (const chunk of exportChunks(
      { tenantId: a.tenant.id, subjectPartyId: a.person, createdAt: new Date().toISOString() },
      data,
    )) {
      text += chunk;
    }
    const seconds = (performance.now() - started) / 1000;
    console.info(
      `Subject access data for ${String(APPLICATIONS)} applications took ${seconds.toFixed(2)} s.`,
    );
    expect(seconds).toBeLessThan(60);

    const file = subjectAccessExportSchema.parse(JSON.parse(text));
    expect(file.modules.grants?.['grants.application']).toHaveLength(APPLICATIONS);
    const first = file.modules.grants?.['grants.application']?.[0];
    expect(Object.keys(first ?? {}).filter((id) => id.startsWith('f_'))).toHaveLength(50);
    expect(first?.['f_q0']?.sensitivity).toBe('special_category');
    expect(outputSensitivity(data)).toBe('special_category');
  });

  it('adds the memberships of the person and what they made', async () => {
    const { platform } = (await collect(a.tenant, a.person)).modules;
    expect(platform?.['app.membership']).toHaveLength(1);
    expect(platform?.['app.membership']?.[0]?.['app.membership.roles']?.value).toEqual([
      'applicant',
    ]);
    for (const table of ['app.file', 'app.invitation', 'app.job_request']) {
      expect(platform?.[table], table).toHaveLength(1);
    }
    expect(platform?.['app.file']?.[0]?.['app.file.created_by']?.value).toBe(a.membership);
    expect(platform?.['app.file']?.[0]?.['app.file.name']?.sensitivity).toBe('personal');
    expect(Object.keys(platform?.['app.invitation']?.[0] ?? {})).not.toContain(
      'app.invitation.token_hash',
    );
  });

  it("leaves out the party a request was made for, which a filter can name (someone else's id)", async () => {
    const { platform } = (await collect(a.tenant, a.person)).modules;
    expect(platform?.['app.job_request']?.[0]).not.toHaveProperty(['app.job_request.filters']);
    expect(JSON.stringify(platform)).not.toContain(a.bystander);
  });

  it('leaves out audit events and fields that show an unreleased outcome or how far an application has moved', async () => {
    const tenant = await createTestTenant();
    const stage = randomUUID();
    const person = await asMigratorIn(tenant.id, async (client) => {
      const subject = await addPerson(client, tenant);
      const userId = await createTestUser();
      const membership = await insertRow(client, 'app.membership', {
        tenant_id: tenant.id,
        user_id: userId,
        roles: ['programme_manager'],
      });
      await client.query('UPDATE party.person SET user_id = $2 WHERE id = $1', [subject, userId]);
      const audit = (action: string, changes: Record<string, unknown>, byMember = false) =>
        insertRow(client, 'app.audit_event', {
          tenant_id: tenant.id,
          request_id: randomUUID(),
          actor_kind: byMember ? 'user' : 'system',
          actor_id: byMember ? membership : null,
          action,
          entity_type: action.split('.').slice(0, 2).join('.'),
          entity_id: randomUUID(),
          changes,
          subject_party_id: byMember ? null : subject,
        });
      await audit('grants.review.submitted', {
        'grants.assignment.status': { before: 'assigned', after: 'submitted' },
      });
      await audit('grants.assignment.conflict_declared', {
        'grants.assignment.status': { before: 'assigned', after: 'conflicted' },
      });
      await audit(
        'grants.reviewer.added',
        { 'grants.reviewer.membership_id': { before: null, after: stage } },
        true,
      );
      await audit(
        'grants.reviewer.removed',
        { 'grants.reviewer.membership_id': { before: stage, after: null } },
        true,
      );
      await audit('grants.decision.recorded', {
        'grants.decision.outcome': { before: null, after: 'declined' },
      });
      await audit('grants.decision.changed', {
        'grants.decision.outcome': { before: 'declined', after: 'accepted' },
      });
      await audit('grants.assignment.created', {
        'grants.assignment.reviewer_membership_id': { before: null, after: stage },
      });
      await audit('grants.application.stage_changed', {
        'grants.application.stage_id': { before: null, after: stage },
      });
      await audit('grants.application.submitted', {
        'grants.application.status': { before: 'draft', after: 'submitted' },
        'grants.application.stage_id': { before: null, after: stage },
      });
      return subject;
    });
    const { auditEvents } = await collect(tenant, person);
    expect(auditEvents.map((event) => event.action)).toEqual(['grants.application.submitted']);
    expect(Object.keys(auditEvents[0]?.changes ?? {})).toEqual(['grants.application.status']);
    expect(JSON.stringify(auditEvents)).not.toContain(stage);
    expect(JSON.stringify(auditEvents)).not.toContain('declined');
    expect(JSON.stringify(auditEvents)).not.toContain('conflicted');
  });

  it('adds the audit events about the person or their merged duplicate, or done by their memberships, by kind', async () => {
    const data = await collect(a.tenant, a.person);
    expect(data.auditEvents.map((event) => event.actor.kind).sort()).toEqual([
      'applicant',
      'applicant',
      'staff',
      'system',
      'system',
    ]);
    expect(data.auditEvents.map((event) => event.entityId)).toEqual(
      expect.arrayContaining([a.duplicate, a.bystander]),
    );
    expect(JSON.stringify(data.auditEvents)).not.toContain(a.staff);
    expect(JSON.stringify(data.auditEvents)).not.toContain(a.membership);
  });

  it('adds the rows a merged duplicate was written with, from either end of the merge', async () => {
    for (const asked of [a.person, a.duplicate]) {
      const { party } = (await collect(a.tenant, asked)).modules;
      expect(party?.['party.person']?.map((row) => row['party.person.id']?.value).sort()).toEqual(
        [a.person, a.duplicate].sort(),
      );
      expect(
        party?.['party.consent']?.map((row) => row['party.consent.privacy_notice_version']?.value),
      ).toEqual(['2026-09']);
    }
  });

  it('finds an event the person only took part in as actor, and not events about another person', async () => {
    const data = await collect(a.tenant, a.person);
    expect(data.auditEvents.filter((event) => event.entityId === a.bystander)).toHaveLength(1);
    const about = await collect(a.tenant, a.bystander);
    expect(about.auditEvents.map((event) => event.actor.kind)).toEqual(['staff']);
    expect(about.modules.platform).toBeUndefined();
  });

  it("finds nothing of another tenant's person, in either direction", async () => {
    for (const [tenant, stranger] of [
      [a.tenant, b.person],
      [b.tenant, a.person],
    ] as const) {
      const data = await collect(tenant, stranger);
      expect(data.auditEvents).toEqual([]);
      expect(data.modules.platform).toBeUndefined();
      for (const tables of Object.values(data.modules)) {
        for (const rows of Object.values(tables)) expect(rows).toEqual([]);
      }
    }
  });
});
