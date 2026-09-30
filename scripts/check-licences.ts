// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm check:licences` (ADR 0002) fails unless:
//   1. every installed dependency's licence passes licence-policy.json;
//   2. every workspace package is private and AGPL-3.0-or-later;
//   3. every source file carries the SPDX line in its first lines.
//
//   node scripts/check-licences.ts [--summary <file>]
//
// --summary writes the dependencies checked, as a count and as a list of
// name@version, so CI can compare them with what the vulnerability scanner
// and SBOM saw.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluate,
  policyProblems,
  unusedExceptions,
  type InstalledPackage,
  type LicencePolicy,
} from './licence-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const PROJECT_LICENCE = 'AGPL-3.0-or-later';
const SPDX_LINE = `SPDX-License-Identifier: ${PROJECT_LICENCE}`;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.sql', '.sh']);
const HEADER_LINES = 5;

/** Run the pnpm that started this script, so no shell is needed on Windows. */
function pnpm(args: readonly string[]): string {
  const execPath = process.env['npm_execpath'];
  const [command, prefix] = !execPath
    ? ['pnpm', []]
    : /\.[cm]?js$/.test(execPath)
      ? [process.execPath, [execPath]]
      : [execPath, []];
  return execFileSync(command, [...prefix, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

interface LicenceListEntry {
  name: string;
  versions: string[];
  license: string;
}

function listPackages(production: boolean): InstalledPackage[] {
  const output = pnpm([
    'licenses',
    'list',
    '--json',
    '--loglevel=error',
    ...(production ? ['--prod'] : []),
  ]);
  // Anything pnpm prints before the JSON, such as a version warning, is not part of it.
  const json = output.slice(output.indexOf('{'));
  const byLicence = JSON.parse(json) as Record<string, LicenceListEntry[]>;
  return Object.values(byLicence).flatMap((entries) =>
    entries.flatMap((entry) =>
      entry.versions.map((version) => ({
        name: entry.name,
        version,
        licence: entry.license,
        production,
      })),
    ),
  );
}

interface DependencyCount {
  dependencies: number;
  production: number;
  packages: string[];
}

function checkDependencies(
  policy: LicencePolicy,
  failures: string[],
  count: DependencyCount,
): string {
  const production = listPackages(true);
  const productionIds = new Set(production.map((pkg) => `${pkg.name}@${pkg.version}`));
  const all = listPackages(false).map((pkg) => ({
    ...pkg,
    production: productionIds.has(`${pkg.name}@${pkg.version}`),
  }));

  let excepted = 0;
  for (const pkg of all) {
    const verdict = evaluate(pkg, policy);
    if (!verdict.ok) failures.push(verdict.reason);
    else if (verdict.exception) excepted += 1;
  }
  for (const entry of unusedExceptions(all, policy)) {
    failures.push(
      `licence-policy.json has an exception for ${entry.package}@${entry.version}, which is not installed; remove it`,
    );
  }
  count.dependencies = all.length;
  count.production = production.length;
  count.packages = [...new Set(all.map((pkg) => `${pkg.name}@${pkg.version}`))].sort();
  return `${String(all.length)} dependencies (${String(production.length)} in production), ${String(excepted)} by recorded exception`;
}

function checkWorkspaceManifests(failures: string[]): string {
  const manifests = ['package.json'];
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(join(group, entry.name, 'package.json'));
    }
  }
  for (const manifest of manifests) {
    const { license, private: isPrivate } = JSON.parse(
      readFileSync(join(root, manifest), 'utf8'),
    ) as { license?: string; private?: boolean };
    if (license !== PROJECT_LICENCE) {
      failures.push(`${manifest} must set "license": "${PROJECT_LICENCE}"`);
    }
    if (isPrivate !== true) failures.push(`${manifest} must set "private": true`);
  }
  return `${manifests.length} workspace manifests`;
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path)) || /(^|\.)Dockerfile$/.test(basename(path));
}

function checkSourceHeaders(failures: string[]): string {
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter((path) => path !== '' && isSourceFile(path));

  let checked = 0;
  for (const path of files) {
    let text: string;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue; // Deleted in the working tree but still in the index.
    }
    checked += 1;
    const head = text.split(/\r?\n/, HEADER_LINES).join('\n');
    if (!head.includes(SPDX_LINE)) failures.push(`${path} needs "${SPDX_LINE}" in its first lines`);
  }
  return `${checked} source files`;
}

function main(argv: readonly string[]): number {
  const policy = JSON.parse(
    readFileSync(join(root, 'licence-policy.json'), 'utf8'),
  ) as LicencePolicy;
  const failures: string[] = [...policyProblems(policy)];
  const count: DependencyCount = { dependencies: 0, production: 0, packages: [] };
  const summary = [
    checkDependencies(policy, failures, count),
    checkWorkspaceManifests(failures),
    checkSourceHeaders(failures),
  ];

  if (failures.length > 0) {
    console.error(`Licence check failed:\n${failures.map((line) => `  - ${line}`).join('\n')}`);
    return 1;
  }
  console.log(`Licence check passed: ${summary.join('; ')}.`);

  const summaryIndex = argv.indexOf('--summary');
  if (summaryIndex !== -1) {
    const file = argv[summaryIndex + 1];
    if (!file) throw new Error('--summary needs a file name.');
    writeFileSync(file, JSON.stringify(count) + '\n');
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
