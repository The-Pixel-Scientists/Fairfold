// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks infra/bi/test.sh runs on Node.js:
//   snapshot <tenant id> <organisations>  a synthetic snapshot, written by
//                                         the platform's own snapshot code
//   explain                               an EXPLAIN of each starter
//                                         dataset's SQL, for psql to run as
//                                         the read-only role
//   contract                              fails unless dashboards/contract.yaml
//                                         targets the model and data contract
//                                         versions in packages/domain
//   compose                               fails unless the rendered Compose
//                                         configuration (JSON on standard
//                                         input) keeps the BI services apart
// The data is made up here, so no real person is in it.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classification } from '../../packages/db/classification.ts';
import {
  dataContracts,
  warehouseModelVersion,
  type WarehouseRow,
} from '../../packages/domain/src/warehouse/index.ts';
import type { TenantTransaction } from '../../apps/api/src/database.ts';
import {
  buildSnapshot,
  type Contribution,
} from '../../apps/api/src/platform/warehouse/snapshot.ts';

const here = import.meta.dirname;
const bundle = join(here, 'dashboards');

/** A stable id for the nth thing of a kind in a tenant's data. */
function id(seed: string, kind: string, n: number): string {
  const hex = createHash('sha256')
    .update(`${seed}:${kind}:${String(n)}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const legalForms = [
  'registered_charity',
  'charitable_incorporated_organisation',
  'company_limited_by_guarantee',
  'community_interest_company',
  'unincorporated_group',
] as const;

const outcomes = ['accepted', 'declined', 'waitlisted', null] as const;

async function snapshot(tenantId: string, count: number): Promise<string> {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error('Give the number of organisations.');
  const at = '2026-01-05T09:00:00.000Z';
  const organisations: WarehouseRow<'organisation'>[] = Array.from({ length: count }, (_, n) => ({
    id: id(tenantId, 'organisation', n),
    status: 'active',
    name: `Synthetic organisation ${String(n + 1)}`,
    legal_form: legalForms[n % legalForms.length] ?? 'other',
    website: null,
    org_id: null,
    org_id_verified: null,
    created_at: at,
  }));
  const people: WarehouseRow<'person'>[] = organisations.map((_, n) => ({
    id: id(tenantId, 'person', n),
    status: 'active',
    created_at: at,
  }));
  const programmes: WarehouseRow<'programme'>[] = ['Community grants', 'Small grants'].map(
    (title, n) => ({
      id: id(tenantId, 'programme', n),
      title,
      summary: `${title} for synthetic organisations.`,
      status: 'open',
      created_at: at,
    }),
  );
  const rounds: WarehouseRow<'grants_round'>[] = [
    'Spring 2026',
    'Autumn 2026',
    'Small grants 2026',
  ].map((title, n) => ({
    id: id(tenantId, 'round', n),
    programme_id: id(tenantId, 'programme', n === 2 ? 1 : 0),
    title,
    opens_at: '2026-01-12T09:00:00.000Z',
    closes_at: '2026-02-27T17:00:00.000Z',
    budget_minor: 50_000_000,
    award_min_minor: 100_000,
    award_max_minor: 2_500_000,
    currency: 'GBP',
    created_at: at,
  }));
  const applications: WarehouseRow<'grants_application'>[] = [];
  const commitments: WarehouseRow<'commitment'>[] = [];
  organisations.forEach((organisation, n) => {
    const round = rounds[n % rounds.length];
    if (round === undefined) return;
    const withdrawn = n % 7 === 6;
    const outcome = withdrawn ? null : (outcomes[n % outcomes.length] ?? null);
    const commitmentId = outcome === 'accepted' ? id(tenantId, 'commitment', n) : null;
    applications.push({
      id: id(tenantId, 'application', n),
      round_id: round.id,
      organisation_id: organisation.id,
      applicant_person_id: id(tenantId, 'person', n),
      status: withdrawn ? 'withdrawn' : 'submitted',
      submitted_at: '2026-02-20T12:00:00.000Z',
      submitted_late: n % 5 === 4,
      withdrawn_at: withdrawn ? '2026-03-02T10:00:00.000Z' : null,
      outcome,
      commitment_id: commitmentId,
      created_at: '2026-02-01T12:00:00.000Z',
    });
    if (commitmentId !== null) {
      commitments.push({
        id: commitmentId,
        programme_id: round.programme_id,
        organisation_id: organisation.id,
        amount_minor: 500_000 + n * 125_000,
        currency: 'GBP',
        committed_on: `2026-${String(3 + (n % 9)).padStart(2, '0')}-15`,
      });
    }
  });

  const fed = (rows: Record<string, readonly Readonly<Record<string, unknown>>[]>) =>
    Object.fromEntries(
      Object.entries(rows).map(([name, list]) => [name, () => Promise.resolve(list)]),
    );
  const contributions: Contribution[] = [
    { module: 'party', tables: fed({ organisation: organisations, person: people }) },
    {
      module: 'grants',
      tables: fed({
        programme: programmes,
        commitment: commitments,
        grants_round: rounds,
        grants_application: applications,
        grants_score: [],
      }),
    },
  ];
  const { script } = await buildSnapshot({} as TenantTransaction, {
    tenantId,
    tenant: { timezone: 'Europe/London', fiscalYearStartMonth: 4 },
    contributions,
    classification,
    // Recent, so load.sh accepts it as at most 30 days old.
    at: new Date(Date.now() - 3_600_000),
    maxBytes: 5 * 1024 * 1024,
  });
  return script;
}

/** Each dataset's SQL, from its `sql: |-` block. */
function explain(): string {
  const folder = join(bundle, 'datasets', 'warehouse');
  return readdirSync(folder)
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => {
      const text = readFileSync(join(folder, name), 'utf8');
      const block = /^sql: \|-\n((?: {2}.*\n)+)/m.exec(text)?.[1];
      if (block === undefined) throw new Error(`${name} has no sql: |- block.`);
      const sql = block.replace(/^ {2}/gm, '').trim();
      if (sql.includes(';') || sql.includes('{{'))
        throw new Error(`${name} must hold one plain query.`);
      return `\\echo ${name}\nEXPLAIN ${sql};\n`;
    })
    .join('');
}

function contractProblems(): string[] {
  const text = readFileSync(join(bundle, 'contract.yaml'), 'utf8');
  const model = Number(/^model_version: (\d+)$/m.exec(text)?.[1]);
  const block = /^data_contracts:\n((?: {2}\w+: \d+\n)+)/m.exec(text)?.[1] ?? '';
  const targets = [...block.matchAll(/^ {2}(\w+): (\d+)$/gm)];
  const problems: string[] = [];
  if (model !== warehouseModelVersion) {
    problems.push(
      `The dashboards target model version ${String(model)}, not ${String(warehouseModelVersion)}.`,
    );
  }
  if (targets.length === 0) problems.push('contract.yaml names no data contract.');
  for (const [, module = '', version = ''] of targets) {
    const contract = Object.hasOwn(dataContracts, module)
      ? (dataContracts as Record<string, { version: number } | null>)[module]
      : null;
    if (contract?.version !== Number(version)) {
      problems.push(
        `The dashboards target ${module} data contract version ${version}, which is not published.`,
      );
    }
  }
  return problems;
}

interface ComposeConfig {
  services: Record<
    string,
    {
      image?: string;
      build?: unknown;
      networks?: Record<string, unknown>;
      ports?: { host_ip?: string }[];
    }
  >;
  networks: Record<string, { internal?: boolean }>;
}

function composeProblems(config: ComposeConfig): string[] {
  const problems: string[] = [];
  if (config.networks['bi']?.internal !== true) problems.push('The bi network must be internal.');
  const built = config.services['bi']?.image;
  if (built === undefined || config.services['bi-init']?.image !== built) {
    problems.push('bi and bi-init must run the one image built from infra/bi.');
  }
  for (const [name, service] of Object.entries(config.services)) {
    const networks = Object.keys(service.networks ?? {});
    const ours = name === 'bi' || name.startsWith('bi-');
    for (const network of networks) {
      const allowed = ours
        ? network === 'bi' || (network === 'bi-edge' && name === 'bi')
        : !network.startsWith('bi');
      if (!allowed) problems.push(`${name} must not join ${network}.`);
    }
    if (ours && service.build === undefined && !/@sha256:[0-9a-f]{64}$/.test(service.image ?? '')) {
      problems.push(`${name} must run an image pinned by digest.`);
    }
    if (ours && (service.ports ?? []).some((port) => port.host_ip !== '127.0.0.1')) {
      problems.push(`${name} must publish ports on 127.0.0.1 only.`);
    }
  }
  return problems;
}

function report(problems: string[]): number {
  for (const problem of problems) console.error(problem);
  return problems.length === 0 ? 0 : 1;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'snapshot') {
  process.stdout.write(await snapshot(args[0] ?? '', Number(args[1])));
} else if (command === 'explain') {
  process.stdout.write(explain());
} else if (command === 'contract') {
  process.exitCode = report(contractProblems());
} else if (command === 'compose') {
  process.exitCode = report(composeProblems(JSON.parse(readFileSync(0, 'utf8')) as ComposeConfig));
} else {
  console.error(
    'Usage: node infra/bi/tools.ts snapshot <tenant id> <organisations> | explain | contract | compose',
  );
  process.exitCode = 1;
}
