// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The release's licence inventory (ADR 0002, Gate 1 evidence), built from
// what the release pipeline produced rather than from node_modules:
//
//   node scripts/licence-inventory.ts --sbom <dir> --out <dir>
//
// <dir> holds one CycloneDX SBOM per release image (<image>.cdx.json, from
// Syft) and licences.json, which `pnpm check:licences --summary` wrote for
// the same commit. It writes licence-inventory.json and licence-inventory.md
// to --out, and fails if a shipped npm package fails licence-policy.json or
// has no licence, if the SBOMs hold a package the licence check did not see,
// if an exception is past its quarterly review, or if a Compose image has no
// entry with an OSI-approved licence in the policy's `services`. Separate
// containers and CI tools are listed, not held to the dependency table, and
// operating system packages are listed as Syft reports them.
//
// The release tag and commit come from TAG and GITHUB_SHA, as the release
// workflow sets them; locally the commit is HEAD.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluate,
  policyProblems,
  unusedExceptions,
  type InstalledPackage,
  type LicenceException,
  type LicencePolicy,
} from './licence-policy.ts';

export interface PolicyService {
  name: string;
  kind: 'service' | 'tool';
  /** The image repository Compose runs, for a service. */
  image?: string;
  licence: string;
}

export type InventoryPolicy = LicencePolicy & { services: PolicyService[] };

/** What `pnpm check:licences --summary` writes. */
export interface LicenceSummary {
  dependencies: number;
  production: number;
  packages: string[];
}

interface CycloneDxLicence {
  expression?: string;
  license?: { id?: string; name?: string; url?: string };
}

interface CycloneDxComponent {
  purl?: string;
  licenses?: CycloneDxLicence[];
}

export interface CycloneDx {
  metadata?: { component?: { name?: string; version?: string } };
  components?: CycloneDxComponent[];
}

export interface InventoryInput {
  /** One per release image, named as its SBOM file is. */
  sboms: { image: string; bom: CycloneDx }[];
  policy: InventoryPolicy;
  summary: LicenceSummary;
  /** The Compose files and the Dockerfiles Compose builds services from. */
  composeFiles: { path: string; text: string }[];
  /** This repository's own package names. */
  workspace: readonly string[];
  /** YYYY-MM-DD, for exception reviews. */
  today: string;
  tag: string;
  commit: string;
}

type ReviewStatus = 'current' | 'due' | 'overdue';

export interface Inventory {
  release: { tag: string; commit: string };
  images: { image: string; ref: string; digest: string }[];
  packages: {
    name: string;
    version: string;
    licence: string;
    images: string[];
    production: boolean;
    policy: 'allowed' | 'exception' | 'fails';
  }[];
  byLicence: { licence: string; count: number }[];
  project: { name: string; version: string; licence: string; images: string[] }[];
  exceptions: (LicenceException & { nextReview: string; review: ReviewStatus; used: boolean })[];
  services: {
    name: string;
    image: string;
    version: string;
    digest: string;
    licence: string;
    files: string[];
  }[];
  unusedServices: string[];
  tools: { name: string; licence: string }[];
  osPackages: { licence: string; count: number; packages: string[] }[];
  problems: string[];
}

const PROJECT_LICENCE = 'AGPL-3.0-or-later';
const REVIEW_MONTHS = 3;
const DUE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * OSI-approved licences (opensource.org/licenses) that services and tools
 * may use. Add one only after checking it is on the OSI list.
 */
const OSI_APPROVED = new Set([
  '0BSD',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MPL-2.0',
  'PostgreSQL',
]);

const PINNED_IMAGE = /([a-z0-9][a-z0-9._/-]*):([A-Za-z0-9_][A-Za-z0-9_.-]*)@(sha256:[0-9a-f]{64})/g;
const DIGEST = /sha256:[0-9a-f]{64}/;

/**
 * A component's licence as its SBOM entry gives it: ids, names, URLs and
 * expressions, every one required. Nothing is mapped, so a name or URL that
 * is not SPDX fails the policy rather than being guessed at.
 */
function reportedLicence(component: CycloneDxComponent): string {
  const parts = (component.licenses ?? [])
    .map(
      (entry) => entry.expression ?? entry.license?.id ?? entry.license?.name ?? entry.license?.url,
    )
    .filter((part): part is string => part !== undefined && part.trim() !== '');
  if (parts.length <= 1) return parts[0]?.trim() ?? '';
  return parts.map((part) => `(${part.trim()})`).join(' AND ');
}

/** Type, name and version from a package URL, such as pkg:npm/%40scope/name@1.0.0. */
function fromPurl(purl: string): { type: string; name: string; version: string } | undefined {
  const match = /^pkg:([a-z0-9.+-]+)\/([^?#]+?)(?:@([^?#@/]+))?(?:[?#].*)?$/.exec(purl);
  if (!match) return undefined;
  const [, type = '', path = '', version = ''] = match;
  const name = decodeURIComponent(path);
  return {
    type,
    name: type === 'npm' ? name : (name.split('/').pop() ?? name),
    version: decodeURIComponent(version),
  };
}

function splitId(id: string): { name: string; version: string } {
  const at = id.lastIndexOf('@');
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

export function nextReview(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + REVIEW_MONTHS + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + REVIEW_MONTHS, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function reviewStatus(next: string, today: string): ReviewStatus {
  const days = (Date.parse(next) - Date.parse(today)) / DAY_MS;
  return days < 0 ? 'overdue' : days <= DUE_DAYS ? 'due' : 'current';
}

const byText = (a: string, b: string) => a.localeCompare(b, 'en');

const plural = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

export function buildInventory(input: InventoryInput): Inventory {
  const { policy, today } = input;
  const problems = [...policyProblems(policy)];
  const workspace = new Set(input.workspace);
  const seen = new Set(input.summary.packages);

  const images: Inventory['images'] = [];
  const npm = new Map<
    string,
    { name: string; version: string; licence: string; images: Set<string> }
  >();
  const os = new Map<string, { licence: string; id: string }>();

  for (const { image, bom } of [...input.sboms].sort((a, b) => byText(a.image, b.image))) {
    const ref = bom.metadata?.component?.name ?? '';
    const digest = (DIGEST.exec(ref) ?? DIGEST.exec(bom.metadata?.component?.version ?? ''))?.[0];
    if (!digest)
      problems.push(`The ${image} SBOM names no image digest; scan the image by digest.`);
    images.push({ image, ref, digest: digest ?? '' });

    for (const component of bom.components ?? []) {
      const pkg = component.purl ? fromPurl(component.purl) : undefined;
      if (!pkg) continue;
      const licence = reportedLicence(component);
      const id = `${pkg.name}@${pkg.version}`;
      if (pkg.type !== 'npm') {
        os.set(`${pkg.type}:${id}`, { licence: licence || 'none reported', id });
        continue;
      }
      const entry = npm.get(id) ?? { ...pkg, licence, images: new Set<string>() };
      if (entry.licence !== licence) {
        problems.push(
          `${id} has two licences in the SBOMs ("${entry.licence}" and "${licence}"); check its package.json.`,
        );
      }
      entry.images.add(image);
      npm.set(id, entry);
    }
  }
  if (npm.size === 0) {
    problems.push('The SBOMs hold no npm packages; check Syft scanned the release images.');
  }

  const packages: Inventory['packages'] = [];
  const project: Inventory['project'] = [];
  for (const id of [...npm.keys()].sort(byText)) {
    const entry = npm.get(id);
    if (!entry) continue;
    const shippedIn = [...entry.images].sort(byText);
    const where = `ships in ${shippedIn.join(', ')}`;
    if (workspace.has(entry.name)) {
      if (entry.licence !== PROJECT_LICENCE) {
        problems.push(
          `${id} is this project's own package but its SBOM licence is "${entry.licence}"; set "license": "${PROJECT_LICENCE}" in its package.json.`,
        );
      }
      project.push({
        name: entry.name,
        version: entry.version,
        licence: entry.licence,
        images: shippedIn,
      });
      continue;
    }
    if (!seen.has(id)) {
      problems.push(
        `${id} ${where}, but pnpm check:licences did not see it; build the images and the licence summary from the same commit.`,
      );
    }
    // Whatever ships in a release image is held to the production rules.
    const installed: InstalledPackage = {
      name: entry.name,
      version: entry.version,
      licence: entry.licence,
      production: true,
    };
    const verdict = entry.licence === '' ? undefined : evaluate(installed, policy);
    if (!verdict) {
      problems.push(
        `${id} ${where} with no licence in its SBOM entry; check it declares an SPDX licence, or replace it.`,
      );
    } else if (!verdict.ok) {
      problems.push(
        `${verdict.reason}; it ${where}. Replace it or, where ADR 0002 allows, record an exception in licence-policy.json.`,
      );
    }
    packages.push({
      name: entry.name,
      version: entry.version,
      licence: entry.licence,
      images: shippedIn,
      production: true,
      policy: !verdict?.ok ? 'fails' : verdict.exception ? 'exception' : 'allowed',
    });
  }

  const licenceCounts = new Map<string, number>();
  for (const pkg of packages) {
    const licence = pkg.licence || 'none';
    licenceCounts.set(licence, (licenceCounts.get(licence) ?? 0) + 1);
  }

  const installed = input.summary.packages.map((id) => ({
    ...splitId(id),
    licence: '',
    production: false,
  }));
  const unused = new Set(unusedExceptions(installed, policy));
  const exceptions = [...policy.exceptions]
    .sort((a, b) => byText(`${a.package}@${a.version}`, `${b.package}@${b.version}`))
    .map((entry) => {
      const next = nextReview(entry.date);
      const review = reviewStatus(next, today);
      if (review === 'overdue') {
        problems.push(
          `The exception for ${entry.package}@${entry.version} was due for review on ${next}; review it and, once re-approved, update its date in licence-policy.json.`,
        );
      }
      return { ...entry, nextReview: next, review, used: !unused.has(entry) };
    });

  const services = new Map<string, Inventory['services'][number]>();
  for (const file of [...input.composeFiles].sort((a, b) => byText(a.path, b.path))) {
    for (const [, image = '', version = '', digest = ''] of file.text.matchAll(PINNED_IMAGE)) {
      const key = `${image}:${version}@${digest}`;
      const known = services.get(key);
      if (known) {
        if (!known.files.includes(file.path)) known.files.push(file.path);
        continue;
      }
      const entry = policy.services.find(
        (service) => service.kind === 'service' && service.image === image,
      );
      if (!entry) {
        problems.push(
          `${image}:${version} (${file.path}) has no entry in "services" in licence-policy.json; add its name, image and licence.`,
        );
      }
      services.set(key, {
        name: entry?.name ?? '',
        image,
        version,
        digest,
        licence: entry?.licence ?? '',
        files: [file.path],
      });
    }
  }
  for (const entry of policy.services) {
    if (entry.kind === 'service' && !entry.image) {
      problems.push(
        `The service ${entry.name} in licence-policy.json needs the image it runs from.`,
      );
    }
    if (!OSI_APPROVED.has(entry.licence)) {
      problems.push(
        `${entry.name} is under "${entry.licence}", which is not an OSI-approved licence ADR 0002 accepts for a separate container or tool.`,
      );
    }
  }
  const used = new Set([...services.values()].map((service) => service.image));

  return {
    release: { tag: input.tag, commit: input.commit },
    images,
    packages,
    byLicence: [...licenceCounts]
      .map(([licence, count]) => ({ licence, count }))
      .sort((a, b) => b.count - a.count || byText(a.licence, b.licence)),
    project,
    exceptions,
    services: [...services.values()].sort(
      (a, b) => byText(a.name, b.name) || byText(a.version, b.version),
    ),
    unusedServices: policy.services
      .filter((entry) => entry.kind === 'service' && entry.image && !used.has(entry.image))
      .map((entry) => entry.name)
      .sort(byText),
    tools: policy.services
      .filter((entry) => entry.kind === 'tool')
      .map(({ name, licence }) => ({ name, licence }))
      .sort((a, b) => byText(a.name, b.name)),
    osPackages: groupOs(os),
    problems,
  };
}

function groupOs(os: Map<string, { licence: string; id: string }>): Inventory['osPackages'] {
  const groups = new Map<string, Set<string>>();
  for (const { licence, id } of os.values()) {
    groups.set(licence, (groups.get(licence) ?? new Set()).add(id));
  }
  return [...groups]
    .map(([licence, ids]) => ({ licence, count: ids.size, packages: [...ids].sort(byText) }))
    .sort((a, b) => b.count - a.count || byText(a.licence, b.licence));
}

/** JSON with sorted keys, so one release always gives the same bytes. */
export function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item === null || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item)
        .sort(([a], [b]) => byText(a, b))
        .map(([key, child]) => [key, sort(child)]),
    );
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

function table(headings: string[], rows: string[][]): string[] {
  if (rows.length === 0) return ['None.'];
  return [
    `| ${headings.join(' | ')} |`,
    `| ${headings.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ];
}

const POLICY_LABEL = { allowed: 'Allowed', exception: 'By exception', fails: 'Fails the policy' };
const REVIEW_LABEL = { current: 'Current', due: 'Review due', overdue: 'Past review' };

export function inventoryMarkdown(inventory: Inventory, generatedAt: string): string {
  const passing = inventory.packages.filter((pkg) => pkg.policy !== 'fails').length;
  const lines = [
    `# Licence inventory for release ${inventory.release.tag}`,
    '',
    `- Release tag: ${inventory.release.tag}`,
    `- Commit: ${inventory.release.commit}`,
    `- Generated: ${generatedAt}`,
    '',
    'Built from the CycloneDX SBOMs that Syft produced for each signed release image and from `licence-policy.json` (ADR 0002).',
    '',
    ...table(
      ['Image', 'Digest'],
      inventory.images.map((image) => [image.image, image.digest || 'Not recorded']),
    ),
    '',
    '## Summary',
    '',
    `${plural(inventory.packages.length, 'npm package')} ship in the release images, under ${plural(inventory.byLicence.length, 'licence')}. ${String(passing)} pass the licence policy.`,
    inventory.problems.length === 0
      ? 'The inventory found no problems.'
      : `The inventory found ${plural(inventory.problems.length, 'problem')}, listed at the end. This release must not be promoted until they are fixed.`,
    '',
    '## Packages by licence',
    '',
    ...table(
      ['Licence', 'Packages'],
      inventory.byLicence.map((row) => [row.licence, String(row.count)]),
    ),
    '',
    '## Packages',
    '',
    'Every npm package found in a release image, once. Anything that ships is held to the production rules.',
    '',
    ...table(
      ['Package', 'Version', 'Licence', 'Images', 'Production', 'Policy'],
      inventory.packages.map((pkg) => [
        pkg.name,
        pkg.version,
        pkg.licence || 'None',
        pkg.images.join(', '),
        pkg.production ? 'Yes' : 'No',
        POLICY_LABEL[pkg.policy],
      ]),
    ),
    '',
    "## This project's packages",
    '',
    ...table(
      ['Package', 'Version', 'Licence', 'Images'],
      inventory.project.map((pkg) => [pkg.name, pkg.version, pkg.licence, pkg.images.join(', ')]),
    ),
    '',
    '## Exceptions',
    '',
    'Per-package exceptions in `licence-policy.json`. Each is reviewed every quarter, three months after its date; re-approving one updates its date.',
    '',
    ...table(
      [
        'Package',
        'Version',
        'Licence',
        'Scope',
        'Reason',
        'Approver',
        'Date',
        'Next review',
        'Review',
        'Installed',
      ],
      inventory.exceptions.map((entry) => [
        entry.package,
        entry.version,
        entry.licence,
        entry.scope,
        entry.reason,
        entry.approver,
        entry.date,
        entry.nextReview,
        REVIEW_LABEL[entry.review],
        entry.used ? 'Yes' : 'No, so it can be removed',
      ]),
    ),
    '',
    '## Services that run as separate containers',
    '',
    'These run in their own containers and are not linked with this code, so they are not held to the dependency licence table (ADR 0002). Each has an OSI-approved licence.',
    '',
    ...table(
      ['Service', 'Image', 'Version', 'Digest', 'Licence', 'Defined in'],
      inventory.services.map((service) => [
        service.name || 'No entry',
        service.image,
        service.version,
        service.digest,
        service.licence || 'None',
        service.files.join(', '),
      ]),
    ),
    ...(inventory.unusedServices.length > 0
      ? ['', `Listed in the policy but not run by Compose: ${inventory.unusedServices.join(', ')}.`]
      : []),
    '',
    '## Tools',
    '',
    'Used only in CI. They never ship.',
    '',
    ...table(
      ['Tool', 'Licence'],
      inventory.tools.map((tool) => [tool.name, tool.licence]),
    ),
    '',
    '## Operating system and other packages',
    '',
    'Packages in the images other than npm packages, with licences as Syft reports them. They do not block a release (ADR 0002).',
    '',
    ...table(
      ['Licence', 'Count', 'Packages'],
      inventory.osPackages.map((group) => [
        group.licence,
        String(group.count),
        group.packages.join(', '),
      ]),
    ),
    ...(inventory.problems.length > 0
      ? ['', '## Problems', '', ...inventory.problems.map((problem) => `- ${problem}`)]
      : []),
  ];
  return `${lines.join('\n')}\n`;
}

const root = fileURLToPath(new URL('..', import.meta.url));
/** The release images, whose contents the SBOMs list. */
const RELEASE_DOCKERFILES = new Set(['infra/docker/api.Dockerfile', 'infra/docker/web.Dockerfile']);

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workspaceNames(): string[] {
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const groups = [...workspace.matchAll(/^ {2}- (\S+)\/\*$/gm)].map((match) => match[1] ?? '');
  const manifests = ['package.json'];
  for (const group of groups) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(join(group, entry.name, 'package.json'));
    }
  }
  return manifests.flatMap((manifest) => {
    try {
      return [(readJson(join(root, manifest)) as { name: string }).name];
    } catch {
      return [];
    }
  });
}

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('Usage: node scripts/licence-inventory.ts --sbom <dir> --out <dir>');
  }
  return value;
}

function main(argv: readonly string[]): number {
  const sbomDir = option(argv, '--sbom');
  const outDir = option(argv, '--out');
  const sboms = readdirSync(sbomDir)
    .filter((file) => file.endsWith('.cdx.json'))
    .map((file) => ({
      image: file.slice(0, -'.cdx.json'.length),
      bom: readJson(join(sbomDir, file)) as CycloneDx,
    }));
  if (sboms.length === 0) throw new Error(`${sbomDir} holds no CycloneDX SBOM (<image>.cdx.json).`);

  const composeFiles = git([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'infra/compose/*.yaml',
    'infra/*Dockerfile',
  ])
    .split('\n')
    .filter((path) => path !== '' && !RELEASE_DOCKERFILES.has(path))
    .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));

  const now = new Date();
  const inventory = buildInventory({
    sboms,
    policy: readJson(join(root, 'licence-policy.json')) as InventoryPolicy,
    summary: readJson(join(sbomDir, 'licences.json')) as LicenceSummary,
    composeFiles,
    workspace: workspaceNames(),
    today: now.toISOString().slice(0, 10),
    tag: process.env['TAG'] ?? 'not tagged (local build)',
    commit: process.env['GITHUB_SHA'] ?? git(['rev-parse', 'HEAD']),
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'licence-inventory.json'), stableJson(inventory));
  writeFileSync(
    join(outDir, 'licence-inventory.md'),
    inventoryMarkdown(inventory, `${now.toISOString().slice(0, 19)}Z`),
  );

  if (inventory.problems.length > 0) {
    console.error(
      `Licence inventory failed:\n${inventory.problems.map((line) => `  - ${line}`).join('\n')}`,
    );
    return 1;
  }
  console.log(
    `Licence inventory written to ${outDir}: ${String(inventory.packages.length)} npm packages, ${String(inventory.services.length)} services.`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
