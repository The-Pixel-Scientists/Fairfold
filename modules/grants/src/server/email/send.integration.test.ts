// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Grants' adapter to the checked send path against the test database, as
// app_api in a tenant's transaction: the purpose comes from the template
// version the row names, marketing and service emails are routed as such, an
// unknown or another tenant's version sends nothing, and S11-58's list still
// refuses marketing on outcome and reminder templates.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import { addProgramme, templateRow } from '../../../../../packages/db/test/grants/fixtures.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { purposeAllowed } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { sendTemplateEmail, type SendChecked } from './index.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly person: string;
  readonly marketing: string;
  readonly serviceLater: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const programme = await addProgramme(client, tenant);
    const marketing = await insertRow(
      client,
      'grants.email_template_version',
      templateRow(tenant, programme, { version: 1, purpose: 'marketing' }),
    );
    const serviceLater = await insertRow(
      client,
      'grants.email_template_version',
      templateRow(tenant, programme, { version: 2, purpose: 'transactional' }),
    );
    return { tenant, person: await addPerson(client, tenant), marketing, serviceLater };
  });
}

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  db = createDatabase<unknown>({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([addFixture(), addFixture()]);
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

function setup() {
  const sendChecked = vi.fn<SendChecked>(() => Promise.resolve({ sent: true }));
  const send = (fixture: Fixture, templateVersionId: string) =>
    withTenant(db, trustedTenantId(fixture.tenant.id), (tx: Tx) =>
      sendTemplateEmail(sendChecked)(tx, {
        templateVersionId,
        personId: fixture.person,
        subject: 'Subject',
        text: 'Text',
        requestId: 'request-1',
      }),
    );
  return { sendChecked, send };
}

describe('sendTemplateEmail', () => {
  it('routes a marketing version through the check with its consent purpose, though a later version is a service email', async () => {
    const { sendChecked, send } = setup();

    expect(await send(a, a.marketing)).toEqual({ sent: true });
    expect(sendChecked).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      personId: a.person,
      message: { kind: 'marketing', purpose: 'future_funding' },
      subject: 'Subject',
      text: 'Text',
      requestId: 'request-1',
    });
  });

  it('routes a service version as transactional', async () => {
    const { sendChecked, send } = setup();

    await send(a, a.serviceLater);
    expect(sendChecked).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: { kind: 'transactional' } }),
    );
  });

  it('sends nothing for a version that is missing or in another tenant', async () => {
    const { sendChecked, send } = setup();

    for (const id of [randomUUID(), b.marketing]) {
      expect(await send(a, id)).toEqual({ sent: false, skipped: false, code: 'invalid_message' });
    }
    expect(sendChecked).not.toHaveBeenCalled();
  });

  it('passes a skip code back for the outbox row', async () => {
    const sendChecked = vi.fn<SendChecked>(() =>
      Promise.resolve({ sent: false, skipped: true, code: 'no_consent' }),
    );
    const result = await withTenant(db, trustedTenantId(a.tenant.id), (tx) =>
      sendTemplateEmail(sendChecked)(tx, {
        templateVersionId: a.marketing,
        personId: a.person,
        subject: 'Subject',
        text: 'Text',
      }),
    );
    expect(result).toEqual({ sent: false, skipped: true, code: 'no_consent' });
  });
});

describe('what grants may send as marketing', () => {
  it('refuses marketing on every outcome and reminder template', () => {
    for (const email of [
      'accepted',
      'waitlisted',
      'declined',
      'draft_closing',
      'review_overdue',
    ] as const) {
      expect(purposeAllowed(email, 'marketing')).toBe(false);
      expect(purposeAllowed(email, 'transactional')).toBe(true);
    }
  });
});
