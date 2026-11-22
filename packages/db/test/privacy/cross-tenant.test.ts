// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cross-tenant denial for every privacy table and every role with a grant
// on it (architecture rule 2), and each composite foreign key refusing
// another tenant's person, membership, job request, request, breach, DPIA,
// activity or processor.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial, type RowFactory } from '../cross-tenant.ts';
import { addErasureRequest } from '../erasure/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  activityRow,
  addPrivacyParts,
  assessmentRow,
  breachRow,
  dpiaRow,
  eventRow,
  insertOutcome,
  processorRow,
  requestRow,
  taskRow,
  type PrivacyParts,
} from './fixtures.ts';

// Each factory adds no other row to the table under test, so the blind
// statements meet one row a tenant, and no row another still refers to.
const memberOf = (client: pg.ClientBase, tenant: TestTenant) => addMember(client, tenant);
const newRequest = async (client: pg.ClientBase, tenant: TestTenant, member: string) =>
  insertRow(
    client,
    'privacy.rights_request',
    requestRow(tenant, await addPerson(client, tenant), member),
  );

const FACTORIES: Readonly<Record<string, RowFactory>> = {
  'privacy.rights_request': async (client, tenant) =>
    requestRow(tenant, await addPerson(client, tenant), await memberOf(client, tenant)),
  'privacy.request_clock_event': async (client, tenant) => {
    const member = await memberOf(client, tenant);
    return eventRow(tenant, await newRequest(client, tenant, member), member);
  },
  'privacy.request_task': async (client, tenant) => {
    const member = await memberOf(client, tenant);
    return taskRow(tenant, await newRequest(client, tenant, member), member);
  },
  'privacy.breach': async (client, tenant) => breachRow(tenant, await memberOf(client, tenant)),
  'privacy.breach_assessment': async (client, tenant) => {
    const member = await memberOf(client, tenant);
    const breach = await insertRow(client, 'privacy.breach', breachRow(tenant, member));
    return assessmentRow(tenant, breach, member);
  },
  'privacy.processing_activity': async (client, tenant) =>
    activityRow(tenant, await memberOf(client, tenant)),
  'privacy.processor': async (client, tenant) =>
    processorRow(tenant, await memberOf(client, tenant)),
  'privacy.processing_activity_processor': async (client, tenant) => {
    const member = await memberOf(client, tenant);
    return {
      tenant_id: tenant.id,
      processing_activity_id: await insertRow(
        client,
        'privacy.processing_activity',
        activityRow(tenant, member),
      ),
      processor_id: await insertRow(client, 'privacy.processor', processorRow(tenant, member)),
      created_by: member,
    };
  },
  'privacy.dpia': async (client, tenant) => dpiaRow(tenant, await memberOf(client, tenant)),
  'privacy.dpia_processing_activity': async (client, tenant) => {
    const member = await memberOf(client, tenant);
    return {
      tenant_id: tenant.id,
      dpia_id: await insertRow(client, 'privacy.dpia', dpiaRow(tenant, member)),
      processing_activity_id: await insertRow(
        client,
        'privacy.processing_activity',
        activityRow(tenant, member),
      ),
      created_by: member,
    };
  },
};

describe('privacy cross-tenant denial', { timeout: 180_000 }, () => {
  it.each(Object.keys(FACTORIES))('%s', (table) =>
    expectCrossTenantDenial(table, FACTORIES[table] as RowFactory),
  );
});

describe('privacy foreign keys across tenants', { timeout: 60_000 }, () => {
  let a: TestTenant;
  let own: PrivacyParts & { job: string };
  let other: PrivacyParts & { job: string };

  beforeAll(async () => {
    const add = (tenant: TestTenant) =>
      asMigratorIn(tenant.id, async (client) => {
        const parts = await addPrivacyParts(client, tenant);
        return {
          ...parts,
          job: await addErasureRequest(client, tenant, parts.member, parts.person),
        };
      });
    a = await createTestTenant();
    own = await add(a);
    other = await add(await createTestTenant());
  });

  const link = (change: Row): Row => ({ tenant_id: a.id, created_by: own.member, ...change });

  const cases = (): [string, string, Row][] => [
    ['person', 'privacy.rights_request', requestRow(a, other.person, own.member)],
    ['membership', 'privacy.rights_request', requestRow(a, own.person, other.member)],
    ['request', 'privacy.request_clock_event', eventRow(a, other.request, own.member)],
    ['membership', 'privacy.request_clock_event', eventRow(a, own.request, other.member)],
    ['request', 'privacy.request_task', taskRow(a, other.request, own.member)],
    [
      'membership',
      'privacy.request_task',
      taskRow(a, own.request, own.member, { assigned_to: other.member }),
    ],
    ['membership', 'privacy.breach', breachRow(a, other.member)],
    ['breach', 'privacy.breach_assessment', assessmentRow(a, other.breach, own.member)],
    ['membership', 'privacy.breach_assessment', assessmentRow(a, own.breach, other.member)],
    ['membership', 'privacy.processing_activity', activityRow(a, other.member)],
    ['membership', 'privacy.processor', processorRow(a, other.member)],
    [
      'activity',
      'privacy.processing_activity_processor',
      link({ processing_activity_id: other.activity, processor_id: own.processor }),
    ],
    [
      'processor',
      'privacy.processing_activity_processor',
      link({ processing_activity_id: own.activity, processor_id: other.processor }),
    ],
    ['membership', 'privacy.dpia', dpiaRow(a, other.member)],
    [
      'DPIA',
      'privacy.dpia_processing_activity',
      link({ dpia_id: other.dpia, processing_activity_id: own.activity }),
    ],
    [
      'activity',
      'privacy.dpia_processing_activity',
      link({ dpia_id: own.dpia, processing_activity_id: other.activity }),
    ],
  ];

  it('refuse each reference to another tenant', async () => {
    for (const [kind, table, row] of cases()) {
      expect(await insertOutcome('app_api', a, table, row), `${table} with B's ${kind}`).toBe(
        '23503',
      );
    }
  });

  it("refuse another tenant's job request on a request", async () => {
    for (const column of ['export_job_request_id', 'erasure_job_request_id']) {
      const result = await asRoleIn('app_api', a.id, (client) =>
        outcome(client, `UPDATE privacy.rights_request SET ${column} = $1 WHERE id = $2`, [
          other.job,
          own.request,
        ]),
      );
      expect(result, column).toBe('23503');
    }
  });
});
