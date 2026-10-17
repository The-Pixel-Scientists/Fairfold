// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the application tests (migration 0011): a round with two
// stages and a published form, an applicant member, person and
// organisation, and applications, eligibility checks, stage moves and file
// links, added through a client with the tenant set.

import { createHash } from 'node:crypto';

import type pg from 'pg';

import { addOrganisation, addPerson } from '../party/fixtures.ts';
import { addMember, insertRow, type Row, type TestTenant } from '../tenants.ts';
import { addRound, addStage } from './fixtures.ts';

/** A definition in S05-01's shape: one section with one question. */
const DEFINITION = {
  sections: [
    {
      id: 's_about',
      title: 'About your project',
      fields: [{ id: 'f_name', type: 'short_text', label: 'Project name', required: true }],
    },
  ],
};

/** What an application refers to. */
export interface Parts {
  readonly member: string;
  readonly round: string;
  readonly stages: readonly [string, string];
  readonly formVersion: string;
  readonly person: string;
  readonly organisation: string;
}

/** A published form version of `round`, as migrator. */
export function addPublishedForm(
  client: pg.ClientBase,
  tenant: TestTenant,
  round: string,
  member: string,
): Promise<string> {
  return insertRow(client, 'grants.form_version', {
    tenant_id: tenant.id,
    round_id: round,
    version: 1,
    status: 'published',
    definition: DEFINITION,
    published_at: new Date(),
    published_by: member,
  });
}

/** Everything a new application needs, as migrator. */
export async function addParts(client: pg.ClientBase, tenant: TestTenant): Promise<Parts> {
  const member = await addMember(client, tenant, ['applicant']);
  const round = await addRound(client, tenant);
  const stages = [
    await addStage(client, tenant, round, { name: 'Intake', position: 1 }),
    await addStage(client, tenant, round, { name: 'Review', position: 2 }),
  ] as const;
  return {
    member,
    round,
    stages,
    formVersion: await addPublishedForm(client, tenant, round, member),
    person: await addPerson(client, tenant),
    organisation: await addOrganisation(client, tenant),
  };
}

/** Columns app_api may insert for a new draft. */
export function applicationRow(tenant: TestTenant, parts: Parts, change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    round_id: parts.round,
    form_version_id: parts.formVersion,
    applicant_person_id: parts.person,
    organisation_id: parts.organisation,
    created_by: parts.member,
    updated_by: parts.member,
    ...change,
  };
}

/** A new draft on new parts, as migrator. */
export async function addApplication(
  client: pg.ClientBase,
  tenant: TestTenant,
): Promise<{ id: string; parts: Parts }> {
  const parts = await addParts(client, tenant);
  return {
    id: await insertRow(client, 'grants.application', applicationRow(tenant, parts)),
    parts,
  };
}

/** Submit draft `id` into `stage`; the database sets the submission time. */
export function submit(client: pg.ClientBase, id: string, stage: string) {
  return client.query(
    "UPDATE grants.application SET status = 'submitted', stage_id = $2 WHERE id = $1",
    [id, stage],
  );
}

/** A file in `state`, as migrator: added pending, then given its verdict. */
export async function addFile(
  client: pg.ClientBase,
  tenant: TestTenant,
  member: string,
  state: 'pending' | 'clean' | 'infected' | 'error' = 'clean',
): Promise<string> {
  const id = await insertRow(client, 'app.file', {
    tenant_id: tenant.id,
    name: 'Accounts 2025.pdf',
    content_type: 'application/pdf',
    size_bytes: 1024,
    created_by: member,
  });
  if (state !== 'pending') {
    const clean = state === 'clean';
    await client.query(
      'UPDATE app.file SET scan_state = $2, sha256 = $3, storage_key = $4 WHERE id = $1',
      [
        id,
        state,
        clean ? createHash('sha256').update(id).digest() : null,
        clean ? `clean/${tenant.id}/${id}` : null,
      ],
    );
  }
  return id;
}
