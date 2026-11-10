// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the ledger re-apply tests (migrations 0048 and 0049): restore
// mode, set by migrator as the restore command sets it, ledger rows, and an
// application whose form version classifies its answers.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { addFile, addParts, applicationRow } from '../grants/application-fixtures.ts';
import { withClient } from '../connect.ts';
import { insertRow, type TestTenant } from '../tenants.ts';

/** A form with a personal and a special category answer, and a public one kept by erasure. */
const CLASSIFIED_DEFINITION = {
  sections: [
    {
      id: 's_about',
      title: 'About you',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Your name', classification: 'personal' },
        {
          id: 'f_ethnicity',
          type: 'short_text',
          label: 'Your ethnicity',
          classification: 'special_category',
        },
        { id: 'f_org', type: 'short_text', label: 'Your organisation', classification: 'public' },
      ],
    },
  ],
};

export const CLASSIFIED_ANSWERS = {
  f_name: 'Ada Lovelace',
  f_ethnicity: 'Prefer not to say',
  f_org: 'Analytical Engines Ltd',
};

export function setRestoreMode(active: boolean): Promise<void> {
  return withClient('migrator', async (client) => {
    await client.query('UPDATE app.restore_mode SET active = $1, request_id = $2', [
      active,
      active ? randomUUID() : null,
    ]);
  });
}

/** Run `work` with the cell in restore mode, and always leave it. */
export async function inRestoreMode<T>(work: () => Promise<T>): Promise<T> {
  await setRestoreMode(true);
  try {
    return await work();
  } finally {
    await setRestoreMode(false);
  }
}

export function ledgerRow(
  client: pg.ClientBase,
  tenant: TestTenant,
  party: string,
  kind: 'party_erased' | 'subject_key_destroyed' = 'party_erased',
): Promise<string> {
  return insertRow(client, 'app.erasure_ledger', {
    tenant_id: tenant.id,
    subject_party_id: party,
    kind,
    subject_key_id: kind === 'subject_key_destroyed' ? randomUUID() : null,
    audit_event_id: randomUUID(),
  });
}

/**
 * An application by a new applicant on a form version that classifies its
 * answers, with one clean linked file, as migrator. `extraAnswers` go in as
 * stored, so a test can hold a key the version does not ask. Returns the
 * application, its applicant and the file.
 */
export async function addClassifiedApplication(
  client: pg.ClientBase,
  tenant: TestTenant,
  extraAnswers: Record<string, unknown> = {},
): Promise<{ application: string; person: string; file: string }> {
  const parts = await addParts(client, tenant);
  const formVersion = await insertRow(client, 'grants.form_version', {
    tenant_id: tenant.id,
    round_id: parts.round,
    version: 2,
    status: 'published',
    definition: CLASSIFIED_DEFINITION,
    published_at: new Date(),
    published_by: parts.member,
  });
  const application = await insertRow(client, 'grants.application', {
    ...applicationRow(tenant, parts, { form_version_id: formVersion }),
    answers: { ...CLASSIFIED_ANSWERS, ...extraAnswers },
  });
  const file = await addFile(client, tenant, parts.member);
  await insertRow(client, 'grants.application_file', {
    tenant_id: tenant.id,
    application_id: application,
    file_id: file,
    field_id: 'f_accounts',
    created_by: parts.member,
  });
  return { application, person: parts.person, file };
}
