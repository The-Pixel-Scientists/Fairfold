// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the forms tests (migration 0079), with plainly synthetic
// values. Rows are added through a client with the tenant set, as migrator,
// and anonymous responses through forms.submit_public_response as app_api.

import { randomBytes, randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { LoginRole } from '../../scripts/roles.ts';
import { withClient } from '../connect.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asRoleIn,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';

const field = (id: string, type: string, classification: string, change: Row = {}) => ({
  id,
  type,
  label: `Synthetic question ${id}`,
  required: false,
  identity: false,
  audiences: ['applicant', 'staff', 'reviewer'],
  classification,
  conditions: [],
  ...change,
});

/** A definition anyone may answer: a personal name, an internal rating and a public choice. */
export const DEFINITION = {
  sections: [
    {
      id: 's_about',
      title: 'About the event',
      conditions: [],
      fields: [
        field('f_name', 'short_text', 'personal'),
        field('f_rating', 'number', 'internal'),
        field('f_venue', 'dropdown', 'public', {
          options: [
            { value: 'north', label: 'North hall' },
            { value: 'south', label: 'South hall' },
          ],
        }),
      ],
    },
  ],
};

/** The same, with a special category question counted only in reports, for signed-in forms. */
export const SIGNED_IN_DEFINITION = {
  sections: [
    {
      ...DEFINITION.sections[0],
      fields: [
        ...(DEFINITION.sections[0]?.fields ?? []),
        field('f_health', 'yes_no', 'special_category', { audiences: 'aggregate_only' }),
      ],
    },
  ],
};

export const ANSWERS = { f_name: 'Synthetic Person', f_rating: 4, f_venue: 'north' };

export const hash = (): Buffer => randomBytes(32);

/** Switch forms on for `tenant`, as the operator's backfill would. */
export async function switchFormsOn(client: pg.ClientBase, tenant: TestTenant, on = true) {
  await client.query(
    `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
     VALUES ($1, 'forms', $2, 'operator')
     ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [tenant.id, on],
  );
}

export const formRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  title: 'Synthetic event feedback',
  respondents: 'both',
  created_by: member,
  updated_by: member,
  ...change,
});

export const draftRow = (
  tenant: TestTenant,
  form: string,
  member: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  form_id: form,
  version: 1,
  definition: JSON.stringify(DEFINITION),
  created_by: member,
  updated_by: member,
  ...change,
});

/** A configuration version for publishing `form`, by `member`. */
export function addConfigVersion(
  client: pg.ClientBase,
  tenant: TestTenant,
  form: string,
  member: string,
): Promise<string> {
  return insertRow(client, 'app.config_version', {
    tenant_id: tenant.id,
    entity_type: 'forms.form',
    entity_id: form,
    version: Math.floor(Math.random() * 1_000_000) + 1,
    author_id: member,
    diff: '{}',
  });
}

/** A published version of `form`, recorded with a new configuration version. */
export async function publishVersion(
  client: pg.ClientBase,
  tenant: TestTenant,
  form: string,
  member: string,
  change: Row = {},
): Promise<string> {
  return insertRow(client, 'forms.form_version', {
    ...draftRow(tenant, form, member),
    status: 'published',
    published_by: member,
    config_version_id: await addConfigVersion(client, tenant, form, member),
    ...change,
  });
}

export interface FormsParts {
  readonly member: string;
  readonly person: string;
  readonly form: string;
  readonly version: string;
}

/** A member, a person, and a form anyone may answer with one published version. */
export async function addFormsParts(
  client: pg.ClientBase,
  tenant: TestTenant,
  formChange: Row = {},
): Promise<FormsParts> {
  const member = await addMember(client, tenant, ['programme_manager']);
  const form = await insertRow(client, 'forms.form', formRow(tenant, member, formChange));
  return {
    member,
    person: await addPerson(client, tenant),
    form,
    version: await publishVersion(client, tenant, form, member),
  };
}

/** A signed-in respondent's submitted response. */
export const responseRow = (tenant: TestTenant, parts: FormsParts, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  form_id: parts.form,
  form_version_id: parts.version,
  route: 'signed_in',
  respondent_person_id: parts.person,
  status: 'submitted',
  answers: JSON.stringify(ANSWERS),
  created_by: parts.member,
  updated_by: parts.member,
  ...change,
});

/** An anonymous response as the function writes it, for migrator to add directly. */
export const anonymousRow = (tenant: TestTenant, parts: FormsParts, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  form_id: parts.form,
  form_version_id: parts.version,
  route: 'anonymous',
  status: 'submitted',
  answers: JSON.stringify(ANSWERS),
  idempotency_key_hash: hash(),
  request_hash: hash(),
  proof_hash: hash(),
  ...change,
});

export const tokenRow = (tenant: TestTenant, response: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  response_id: response,
  token_hash: hash(),
  ...change,
});

/** Insert `row` into `table` as `role` in `tenant`, rolled back: ok, or the SQLSTATE. */
export function insertOutcome(
  role: LoginRole,
  tenant: TestTenant,
  table: string,
  row: Row,
): Promise<string> {
  return asRoleIn(role, tenant.id, (client) => {
    const { text, values } = insertStatement(client, table, row);
    return outcome(client, text, values);
  });
}

export interface Submission {
  readonly slug: string;
  readonly formId: string;
  readonly formVersionId: string;
  readonly answers?: unknown;
  readonly tokenHash?: Buffer;
  readonly keyHash?: Buffer;
  readonly requestHash?: Buffer;
  readonly proofHash?: Buffer | null;
  readonly requestId?: string;
}

export const SUBMIT = `SELECT response_id, code
  FROM forms.submit_public_response($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

/** The function's arguments, with new hashes for any left out. */
export const submitValues = (submission: Submission): unknown[] => [
  submission.slug,
  submission.formId,
  submission.formVersionId,
  JSON.stringify(submission.answers ?? ANSWERS),
  submission.tokenHash ?? hash(),
  submission.keyHash ?? hash(),
  submission.requestHash ?? hash(),
  submission.proofHash === undefined ? hash() : submission.proofHash,
  submission.requestId ?? randomUUID(),
];

export interface Submitted {
  readonly response_id: string | null;
  readonly code: string | null;
}

/** Call the function as app_api with no tenant set, and commit. */
export function submit(submission: Submission): Promise<Submitted> {
  return withClient('app_api', async (client) => {
    const { rows } = await client.query<Submitted>(SUBMIT, submitValues(submission));
    const [row] = rows;
    if (!row) throw new Error('forms.submit_public_response returned no row.');
    return row;
  });
}
