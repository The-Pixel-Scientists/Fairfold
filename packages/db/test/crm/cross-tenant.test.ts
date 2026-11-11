// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cross-tenant denial for every crm table (architecture rule 2), as every app
// role with a grant on it, and each composite foreign key refusing another
// tenant's party, membership, file, list, import job or merge record.

import { beforeAll, describe, expect, it } from 'vitest';

import type { LoginRole } from '../../scripts/roles.ts';
import { expectCrossTenantDenial, type RowFactory } from '../cross-tenant.ts';
import { addFile } from '../grants/application-fixtures.ts';
import { addParty } from '../party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addCrmParts,
  addImportJob,
  eventRow,
  importJobRow,
  importRowRow,
  insertOutcome,
  listRow,
  mergeRow,
  noteRow,
  referenceRow,
  segmentRow,
  type CrmParts,
} from './fixtures.ts';

const FACTORIES: Readonly<Record<string, RowFactory>> = {
  'crm.list': async (client, tenant) => listRow(tenant, (await addCrmParts(client, tenant)).member),
  'crm.list_member': async (client, tenant) => {
    const { member, person } = await addCrmParts(client, tenant);
    const list = await insertRow(client, 'crm.list', listRow(tenant, member));
    return { tenant_id: tenant.id, list_id: list, party_id: person, added_by: member };
  },
  'crm.segment': async (client, tenant) =>
    segmentRow(tenant, (await addCrmParts(client, tenant)).member),
  'crm.interaction': async (client, tenant) => {
    const { member, person } = await addCrmParts(client, tenant);
    return noteRow(tenant, person, member);
  },
  'crm.merge_record': async (client, tenant) => {
    const { member, person } = await addCrmParts(client, tenant);
    return mergeRow(tenant, await addParty(client, tenant, 'person'), person, member);
  },
  'crm.import_job': async (client, tenant) => {
    const { member } = await addCrmParts(client, tenant);
    return importJobRow(tenant, await addFile(client, tenant, member), member);
  },
  'crm.import_row': async (client, tenant) => {
    const { member } = await addCrmParts(client, tenant);
    return importRowRow(tenant, await addImportJob(client, tenant, member));
  },
  'crm.external_reference': async (client, tenant) => {
    const { member, person } = await addCrmParts(client, tenant);
    return referenceRow(tenant, person, member);
  },
};

describe('crm cross-tenant denial', { timeout: 120_000 }, () => {
  it.each(Object.keys(FACTORIES))('%s', (table) =>
    expectCrossTenantDenial(table, FACTORIES[table] as RowFactory),
  );
});

describe('crm foreign keys across tenants', { timeout: 60_000 }, () => {
  let a: TestTenant;
  let b: TestTenant;
  let own: CrmParts & { loser: string; job: string };
  let other: CrmParts;
  let foreign: { list: string; job: string; file: string; loser: string };

  beforeAll(async () => {
    a = await createTestTenant();
    b = await createTestTenant();
    own = await asMigratorIn(a.id, async (client) => {
      const parts = await addCrmParts(client, a);
      return {
        ...parts,
        loser: await addParty(client, a, 'person'),
        job: await addImportJob(client, a, parts.member),
      };
    });
    foreign = await asMigratorIn(b.id, async (client) => {
      other = await addCrmParts(client, b);
      const loser = await addParty(client, b, 'person');
      return {
        list: await insertRow(client, 'crm.list', listRow(b, other.member)),
        job: await addImportJob(client, b, other.member),
        file: await addFile(client, b, other.member),
        loser,
      };
    });
  });

  const cases = (): [string, LoginRole, string, Row][] => [
    ['party', 'app_api', 'crm.interaction', noteRow(a, other.person, own.member)],
    ['membership', 'app_api', 'crm.interaction', noteRow(a, own.person, other.member)],
    ['party', 'app_worker', 'crm.interaction', eventRow(a, other.person)],
    [
      'list',
      'app_api',
      'crm.list_member',
      {
        tenant_id: a.id,
        list_id: foreign.list,
        party_id: own.person,
        added_by: own.member,
      },
    ],
    ['membership', 'app_api', 'crm.list', listRow(a, other.member)],
    ['membership', 'app_api', 'crm.segment', segmentRow(a, other.member)],
    ['party', 'app_api', 'crm.merge_record', mergeRow(a, foreign.loser, own.person, own.member)],
    ['file', 'app_api', 'crm.import_job', importJobRow(a, foreign.file, own.member)],
    ['import job', 'app_worker', 'crm.import_row', importRowRow(a, foreign.job)],
    [
      'party',
      'app_worker',
      'crm.import_row',
      {
        ...importRowRow(a, own.job),
        duplicate_party_id: other.person,
      },
    ],
    ['party', 'app_api', 'crm.external_reference', referenceRow(a, other.person, own.member)],
  ];

  it('refuse each reference to another tenant', async () => {
    for (const [kind, role, table, row] of cases()) {
      expect(await insertOutcome(role, a, table, row), `${table} with B's ${kind}`).toBe('23503');
    }
  });
});
