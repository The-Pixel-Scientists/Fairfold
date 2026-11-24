// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Module off and tenant isolation for the wave 1 tools (ADR 0004, ADR 0016,
// ADR 0024, rule 6). Three funders from the `wave1` seed: Linnetford has every
// tool, Crowmere has grants alone, Sedgebrook has crm and assure.
//
//  - Crowmere's administrator sees no wave 1 section, each tool's console
//    address shows the not-found page, and a sample of each tool's routes,
//    reads and writes, answers 404 with a problem that echoes nothing.
//  - Linnetford switches forms off and back on: 404 and a hidden section while
//    off, the same form afterwards.
//  - Sedgebrook, with the other three tools switched on for the run and off
//    again after it, reads and writes Linnetford's objects by id: 404, nothing
//    changed, and none of them in its lists.
//  - A forged tenant or actor key is refused and changes nothing.
//
// The spec makes its own objects in Linnetford and leaves the seed as it found it,
// apart from those rows.

import { randomUUID } from 'node:crypto';

import type { Role } from '../../packages/domain/src/platform/index.ts';
import { modules } from '../../packages/domain/src/platform/modules.ts';
import { switchTo } from '../platform/modules/switching.ts';
import type { Api, Answer } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { h1 } from '../support/test.ts';
import {
  ABSENT,
  asSlug,
  jsonOf,
  call,
  confirmAgain,
  echoesNothing,
  expect,
  forgedKeys,
  keyed,
  onWave1,
  signInApplicant,
  signInAs,
  staffName,
  test,
  type TenantSlug,
} from './support.ts';

onWave1();

const TOOLS = ['crm', 'assure', 'forms', 'privacy', 'insight'] as const;
const consolePaths: Record<(typeof TOOLS)[number], string> = {
  crm: '/crm',
  assure: '/assure/matches',
  forms: '/forms',
  privacy: '/privacy',
  insight: '/insight',
};

type Made = {
  listId: string;
  organisationId: string;
  personId: string;
  formId: string;
  formVersionId: string;
  responseId: string;
  requestId: string;
  reportId: string;
  runId: string;
  screeningRunId: string;
};

const sessions = new Map<string, Api>();
let made: Made;

async function session(slug: TenantSlug, role: Role): Promise<Api> {
  const key = `${slug}:${role}`;
  const kept = sessions.get(key);
  if (kept !== undefined) return kept;
  const api = await signInAs(slug, role);
  sessions.set(key, api);
  return api;
}

/** A problem the module-off and cross-tenant answers share: 404, a problem body, nothing repeated. */
function expectGone(answer: Answer, label: string, ...repeated: string[]): void {
  expect(answer.status, `${label}: ${answer.text.slice(0, 160)}`).toBe(404);
  expect(answer.headers['content-type'] ?? '', label).toContain('application/problem+json');
  expect(echoesNothing(answer, ...repeated), `${label} echoed`).toBe(true);
}

async function makeObjects(): Promise<Made> {
  const manager = await session('linnetford', 'programme_manager');
  const officer = await session('linnetford', 'due_diligence_officer');
  const admin = await session('linnetford', 'tenant_admin');
  const analyst = await session('linnetford', 'analyst');
  const applicant = await signInApplicant('linnetford');
  sessions.set('linnetford:applicant', applicant);

  const find = async (term: string, kind: 'organisation' | 'person') =>
    (
      await jsonOf<{ results: { id: string }[] }>(
        call(manager, 'POST', '/console/crm/search', { term, kinds: [kind] }),
      )
    ).results[0]?.id ?? '';
  const organisationId = await find('Ravensholt Trading', 'organisation');
  const personId = await find('Dunholt', 'person');

  const { id: listId } = await jsonOf<{ id: string }>(
    keyed(manager, 'POST', '/console/crm/lists', { name: 'Isolation probe list' }),
    201,
  );

  const { id: formId } = await jsonOf<{ id: string }>(
    keyed(manager, 'POST', '/console/forms', {
      title: 'Isolation probe form',
      description: '',
      respondents: 'both',
      opensAt: null,
      closesAt: null,
      confirmationMessage: '',
    }),
    201,
  );
  const definition = {
    sections: [
      {
        id: 's_probe',
        title: 'Probe',
        fields: [{ id: 'f_probe', type: 'short_text', label: 'Anything', required: true }],
      },
    ],
  };
  await jsonOf(call(manager, 'PUT', `/console/forms/${formId}/draft`, { definition }));
  const { id: formVersionId } = await jsonOf<{ id: string }>(
    keyed(manager, 'POST', `/console/forms/${formId}/versions`),
    201,
  );
  const { responseId } = await jsonOf<{ responseId: string }>(
    keyed(applicant, 'POST', `/portal/forms/${formId}/responses`, {
      formVersionId,
      answers: { f_probe: 'isolation-probe-answer' },
    }),
    201,
  );

  const { id: requestId } = await jsonOf<{ id: string }>(
    keyed(admin, 'POST', '/console/rights-requests', {
      personId,
      receivedAt: new Date(Date.now() - 86_400_000).toISOString(),
      kind: 'access',
      channel: 'email',
      summary: 'isolation-probe-summary',
      identityCheck: 'not_started',
    }),
    201,
  );

  const rounds = (
    await jsonOf<{ programmes: { rounds: { id: string; title: string }[] }[] }>(
      call(manager, 'GET', '/console/programmes'),
    )
  ).programmes.flatMap((programme) => programme.rounds);
  const spring = rounds.find(({ title }) => title === 'Spring 2026')?.id;
  const { id: reportId } = await jsonOf<{ id: string }>(
    keyed(analyst, 'POST', '/console/reports', {
      kind: 'monitoring',
      name: 'Isolation probe report',
      description: null,
      source: 'f_sex',
      groupBy: {},
      filters: { [randomUUID()]: { field: 'round', operator: 'eq', value: spring } },
    }),
    201,
  );
  const { runId } = await jsonOf<{ runId: string }>(
    call(analyst, 'POST', `/console/reports/${reportId}/monitoring-runs`),
  );
  const { id: screeningRunId } = await jsonOf<{ id: string }>(
    keyed(officer, 'POST', `/console/parties/${organisationId}/screening-runs`),
    201,
  );
  return {
    listId,
    organisationId,
    personId,
    formId,
    formVersionId,
    responseId,
    requestId,
    reportId,
    runId,
    screeningRunId,
  };
}

test.describe('wave 1 isolation: a tool that is off, and a tenant that is not yours', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    made = await makeObjects();
    // Sedgebrook has only crm and assure; the other three are switched on for the run, and off again after it.
    const farah = await session('sedgebrook', 'tenant_admin');
    await confirmAgain(farah, 'sedgebrook', 'tenant_admin');
    for (const tool of ['forms', 'privacy', 'insight']) {
      await switchTo(farah, staffName('sedgebrook', 'tenant_admin'), tool, true);
    }
  });

  test.afterAll(async () => {
    try {
      const farah = sessions.get('sedgebrook:tenant_admin');
      if (farah !== undefined) {
        await confirmAgain(farah, 'sedgebrook', 'tenant_admin');
        for (const tool of ['forms', 'privacy', 'insight']) {
          await switchTo(farah, staffName('sedgebrook', 'tenant_admin'), tool, false);
        }
      }
    } finally {
      await Promise.all([...sessions.values()].map((api) => api.dispose()));
    }
  });

  test('the funder with grants alone: no wave 1 section, and every console address shows the not-found page', async ({
    pages,
  }) => {
    const page = await pages.staff(staffName('crowmere', 'tenant_admin'), asSlug('crowmere'));
    await axePages(page, ['/crowmere/team']);
    const navigation = page.getByRole('navigation', { name: 'Main' });
    for (const tool of TOOLS) {
      await expect(
        navigation.getByRole('link', { name: modules[tool].label, exact: true }),
        tool,
      ).toHaveCount(0);
    }
    for (const tool of TOOLS) {
      await axePages(page, [`/crowmere${consolePaths[tool]}`]);
      await expect(h1(page, 'Page not found'), tool).toBeVisible();
    }
  });

  test('the funder with grants alone: a sample of each tool answers 404 to a read, a write and an empty write', async () => {
    const admin = await session('crowmere', 'tenant_admin');
    const manager = await session('crowmere', 'programme_manager');
    const reads = [
      '/console/crm/lists',
      '/console/crm/segments',
      '/console/screening-matches',
      '/console/checklists',
      '/console/visits',
      '/console/forms',
      '/console/rights-requests',
      '/console/breaches',
      '/console/dpias',
      '/console/reports',
      '/console/disclosure-rule',
      `/console/forms/${made.formId}`,
      `/console/crm/organisations/${made.organisationId}`,
    ];
    const writes: [string, string][] = [
      ['POST', '/console/crm/lists'],
      ['POST', '/console/crm/search'],
      ['POST', '/console/forms'],
      ['POST', '/console/rights-requests'],
      ['POST', '/console/reports'],
      ['POST', `/console/parties/${made.organisationId}/screening-runs`],
    ];
    for (const caller of [admin, manager]) {
      for (const path of reads) {
        expectGone(await call(caller, 'GET', path), path, path, made.formId, 'crowmere');
      }
      for (const [method, path] of writes) {
        for (const json of [undefined, {}, { name: 'x' }]) {
          const answer = await keyed(caller, method, path, json);
          expectGone(answer, `${method} ${path}`, path, made.organisationId, 'crowmere');
        }
      }
    }
    const publicForm = await admin.send('GET', `/public/tenants/crowmere/forms/${made.formId}`);
    expectGone(publicForm, 'the anonymous form under the other slug', made.formId, 'crowmere');
  });

  test('switching forms off in Linnetford gives 404 and a hidden section, and switching it on again brings the form back', async ({
    pages,
  }) => {
    const admin = await session('linnetford', 'tenant_admin');
    const manager = await session('linnetford', 'programme_manager');
    const name = staffName('linnetford', 'tenant_admin');
    const read = () => call(manager, 'GET', `/console/forms/${made.formId}`);
    const before = (await jsonOf<{ title: string }>(read())).title;
    await confirmAgain(admin, 'linnetford', 'tenant_admin');
    try {
      await switchTo(admin, name, 'forms', false);
      expectGone(await read(), 'the form while forms is off', made.formId);
      for (const json of [undefined, {}]) {
        expectGone(await keyed(manager, 'POST', '/console/forms', json), 'create while off');
      }
      expectGone(
        await call(manager, 'GET', `/public/tenants/linnetford/forms/${made.formId}`),
        'the anonymous form while off',
        made.formId,
        'linnetford',
      );
      const page = await pages.staff(
        staffName('linnetford', 'programme_manager'),
        asSlug('linnetford'),
      );
      await axePages(page, ['/linnetford/team']);
      await expect(
        page
          .getByRole('navigation', { name: 'Main' })
          .getByRole('link', { name: modules.forms.label, exact: true }),
      ).toHaveCount(0);
      await axePages(page, ['/linnetford/forms']);
      await expect(h1(page, 'Page not found')).toBeVisible();
    } finally {
      await switchTo(admin, name, 'forms', true);
    }
    expect((await jsonOf<{ title: string }>(read())).title).toBe(before);
    const totals = await jsonOf<{ received: number }>(
      call(manager, 'GET', `/console/forms/${made.formId}/response-totals`),
    );
    expect(totals.received).toBe(1);
  });

  test('Linnetford’s objects answer 404 by id to another funder, which cannot change them', async () => {
    const pm = await session('sedgebrook', 'programme_manager');
    const admin = await session('sedgebrook', 'tenant_admin');
    const officer = await session('sedgebrook', 'due_diligence_officer');
    const owner = await session('linnetford', 'programme_manager');
    const ownerAdmin = await session('linnetford', 'tenant_admin');
    const ownerAnalyst = await session('linnetford', 'analyst');
    const m = made;

    const reads: [Api, Api, string][] = [
      [pm, owner, `/console/crm/organisations/${m.organisationId}`],
      [pm, owner, `/console/crm/people/${m.personId}`],
      [pm, owner, `/console/crm/lists/${m.listId}/members`],
      [pm, owner, `/console/crm/parties/${m.organisationId}/merges`],
      [officer, owner, `/console/screening-runs/${m.screeningRunId}`],
      [officer, owner, `/console/parties/${m.organisationId}/screening-runs`],
      [pm, owner, `/console/forms/${m.formId}`],
      [pm, owner, `/console/forms/${m.formId}/responses`],
      [pm, owner, `/console/form-responses/${m.responseId}`],
      [admin, ownerAdmin, `/console/rights-requests/${m.requestId}`],
      [admin, ownerAdmin, `/console/rights-requests/${m.requestId}/tasks`],
      [pm, ownerAnalyst, `/console/reports/${m.reportId}`],
      [pm, ownerAnalyst, `/console/report-runs/${m.runId}`],
    ];
    const writes: [Api, string, string, unknown][] = [
      [pm, 'POST', `/console/crm/lists/${m.listId}/members`, { partyIds: [m.organisationId] }],
      [pm, 'PATCH', `/console/crm/lists/${m.listId}`, { name: 'Taken over' }],
      [
        pm,
        'PUT',
        `/console/forms/${m.formId}/settings`,
        {
          title: 'Taken over',
          description: '',
          respondents: 'both',
          opensAt: null,
          closesAt: null,
          confirmationMessage: '',
        },
      ],
      [pm, 'POST', `/console/form-responses/${m.responseId}/spam`, { reason: 'test' }],
      [
        admin,
        'PUT',
        `/console/rights-requests/${m.requestId}`,
        {
          kind: 'access',
          channel: 'email',
          summary: 'Taken over',
          identityCheck: 'verified',
        },
      ],
      [
        admin,
        'POST',
        `/console/rights-requests/${m.requestId}/pause`,
        { on: '2026-01-01', reason: 'identity_proof' },
      ],
    ];

    const readBack = async () =>
      Promise.all(
        reads.map(async ([, ownerSession, path]) => (await call(ownerSession, 'GET', path)).text),
      );
    const before = await readBack();

    for (const [caller, , path] of reads) {
      expectGone(await call(caller, 'GET', path), `GET ${path}`, path, ...Object.values(m));
    }
    for (const [caller, method, path, json] of writes) {
      const answer = await keyed(caller, method, path, json);
      expectGone(answer, `${method} ${path}`, path, ...Object.values(m));
    }
    expect(await readBack(), 'nothing changed').toEqual(before);

    const publicAnswer = await pm.send('GET', `/public/tenants/sedgebrook/forms/${m.formId}`);
    expectGone(publicAnswer, 'the anonymous form under the other slug', m.formId);
  });

  test('Linnetford’s names, ids and emails are in none of another funder’s lists', async () => {
    const pm = await session('sedgebrook', 'programme_manager');
    const admin = await session('sedgebrook', 'tenant_admin');
    const officer = await session('sedgebrook', 'due_diligence_officer');
    const markers = [
      ...Object.values(made),
      'Brinkholt',
      'Dunholt',
      'Ravensholt',
      'Isolation probe',
      'Neighbourhood Fund',
      'linnetford',
      'Linnetford',
    ];
    const answers: [string, Answer][] = [
      ['crm lists', await call(pm, 'GET', '/console/crm/lists')],
      ['crm segments', await call(pm, 'GET', '/console/crm/segments')],
      ['crm search by name', await call(pm, 'POST', '/console/crm/search', { term: 'Brinkholt' })],
      ['crm search by person', await call(pm, 'POST', '/console/crm/search', { term: 'Dunholt' })],
      ['duplicates', await call(pm, 'POST', '/console/crm/duplicates/query', {})],
      ['matches', await call(officer, 'GET', '/console/screening-matches')],
      ['forms', await call(pm, 'GET', '/console/forms')],
      ['rights requests', await call(admin, 'GET', '/console/rights-requests')],
      ['reports', await call(pm, 'GET', '/console/reports')],
    ];
    for (const [label, answer] of answers) {
      expect(answer.status, label).toBe(200);
      expect(
        markers.filter((marker) => answer.text.includes(marker)),
        label,
      ).toEqual([]);
    }
  });

  test('a forged tenant or actor key is refused and changes nothing', async () => {
    const manager = await session('linnetford', 'programme_manager');
    const count = async () =>
      (await jsonOf<{ lists: unknown[] }>(call(manager, 'GET', '/console/crm/lists'))).lists.length;
    const before = await count();
    for (const key of forgedKeys) {
      for (const [path, json] of [
        ['/console/crm/lists', { name: 'Forged list' }],
        [
          '/console/forms',
          {
            title: 'Forged',
            description: '',
            respondents: 'both',
            opensAt: null,
            closesAt: null,
            confirmationMessage: '',
          },
        ],
      ] as const) {
        const answer = await keyed(manager, 'POST', path, { ...json, [key]: ABSENT });
        expect(answer.status, `${path} with ${key}`).toBe(400);
      }
      const query = await manager.send('GET', '/console/crm/lists', { query: { [key]: ABSENT } });
      if (query.status === 200) {
        expect((query.json as { lists: unknown[] }).lists.length, key).toBe(before);
      } else {
        expect(query.status, `a query with ${key}`).toBe(400);
      }
    }
    expect(await count()).toBe(before);
  });
});
