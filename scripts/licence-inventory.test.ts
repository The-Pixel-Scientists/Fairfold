// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildInventory,
  inventoryMarkdown,
  nextReview,
  stableJson,
  type CycloneDx,
  type InventoryInput,
  type InventoryPolicy,
} from './licence-inventory.ts';
import type { LicenceException } from './licence-policy.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const CLAMAV = `clamav/clamav:1.5.4@sha256:${'b'.repeat(64)}`;
const POSTGRES = `postgres:16.15-bookworm@sha256:${'c'.repeat(64)}`;

const exception: LicenceException = {
  package: 'argparse',
  version: '2.0.1',
  licence: 'Python-2.0',
  scope: 'development',
  reason: 'Command-line parsing for a development tool.',
  approver: 'Aaron Gardner',
  date: '2026-10-04',
};

const policy: InventoryPolicy = {
  allowed: ['MIT', 'Apache-2.0'],
  allowedPerPackage: ['Python-2.0', 'AGPL-3.0-or-later'],
  denied: ['GPL-2.0-only', 'SSPL-1.0'],
  exceptions: [exception],
  services: [
    { name: 'ClamAV', kind: 'service', image: 'clamav/clamav', licence: 'GPL-2.0-only' },
    { name: 'PostgreSQL', kind: 'service', image: 'postgres', licence: 'PostgreSQL' },
    { name: 'Syft', kind: 'tool', licence: 'Apache-2.0' },
  ],
};

function npm(name: string, version: string) {
  return { purl: `pkg:npm/${encodeURIComponent(name)}@${version}`, licenses: [] };
}

function sbom(components: NonNullable<CycloneDx['components']>): CycloneDx {
  return {
    metadata: {
      component: { name: `europe-west2-docker.pkg.dev/p/r/api@${DIGEST}`, version: DIGEST },
    },
    components,
  };
}

const cleanComponents = [
  { ...npm('kysely', '0.28.0'), licenses: [{ license: { id: 'MIT' } }] },
  { ...npm('@scope/tool', '1.2.0'), licenses: [{ expression: 'MIT OR GPL-2.0-only' }] },
  {
    ...npm('@pixel-scientists/api', '0.0.0'),
    licenses: [{ license: { id: 'AGPL-3.0-or-later' } }],
  },
  {
    purl: 'pkg:deb/debian/libc6@2.41-12?arch=amd64&distro=debian-13',
    licenses: [{ license: { id: 'LGPL-2.1-or-later' } }, { license: { name: 'GPL-2.0' } }],
  },
  {
    purl: 'pkg:deb/debian/readline-common@8.2-6?arch=all',
    licenses: [{ license: { id: 'GPL-3.0-only' } }],
  },
];

function input(overrides: Partial<InventoryInput> = {}): InventoryInput {
  return {
    sboms: [
      { image: 'api', bom: sbom(cleanComponents) },
      {
        image: 'console',
        bom: sbom([{ ...npm('kysely', '0.28.0'), licenses: [{ license: { id: 'MIT' } }] }]),
      },
    ],
    policy,
    summary: {
      dependencies: 3,
      production: 2,
      packages: ['@scope/tool@1.2.0', 'argparse@2.0.1', 'kysely@0.28.0'],
    },
    composeFiles: [
      {
        path: 'infra/compose/compose.stack.yaml',
        text: `services:\n  clamav:\n    image: ${CLAMAV}\n  postgres:\n    image: ${POSTGRES}\n`,
      },
      { path: 'infra/docker/postgres-dev.Dockerfile', text: `FROM ${POSTGRES}\n` },
    ],
    workspace: ['@pixel-scientists/api', '@pixel-scientists/workspace'],
    today: '2026-11-19',
    tag: 'v1.2.3',
    commit: '0123abc',
    ...overrides,
  };
}

describe('buildInventory', () => {
  it('lists a clean release with no problems', () => {
    const inventory = buildInventory(input());

    expect(inventory.problems).toEqual([]);
    expect(inventory.images).toEqual([
      { image: 'api', ref: `europe-west2-docker.pkg.dev/p/r/api@${DIGEST}`, digest: DIGEST },
      { image: 'console', ref: `europe-west2-docker.pkg.dev/p/r/api@${DIGEST}`, digest: DIGEST },
    ]);
    expect(inventory.packages).toEqual([
      {
        name: '@scope/tool',
        version: '1.2.0',
        licence: 'MIT OR GPL-2.0-only',
        images: ['api'],
        production: true,
        policy: 'allowed',
      },
      {
        name: 'kysely',
        version: '0.28.0',
        licence: 'MIT',
        images: ['api', 'console'],
        production: true,
        policy: 'allowed',
      },
    ]);
    expect(inventory.byLicence).toEqual([
      { licence: 'MIT', count: 1 },
      { licence: 'MIT OR GPL-2.0-only', count: 1 },
    ]);
    expect(inventory.project).toEqual([
      {
        name: '@pixel-scientists/api',
        version: '0.0.0',
        licence: 'AGPL-3.0-or-later',
        images: ['api'],
      },
    ]);
    expect(inventory.osPackages).toEqual([
      { licence: '(LGPL-2.1-or-later) AND (GPL-2.0)', count: 1, packages: ['libc6@2.41-12'] },
      { licence: 'GPL-3.0-only', count: 1, packages: ['readline-common@8.2-6'] },
    ]);
    expect(inventory.tools).toEqual([{ name: 'Syft', licence: 'Apache-2.0' }]);
  });

  it('lists a denied service licence without failing, and each image once', () => {
    const inventory = buildInventory(input());

    expect(inventory.services).toEqual([
      {
        name: 'ClamAV',
        image: 'clamav/clamav',
        version: '1.5.4',
        digest: `sha256:${'b'.repeat(64)}`,
        licence: 'GPL-2.0-only',
        files: ['infra/compose/compose.stack.yaml'],
      },
      {
        name: 'PostgreSQL',
        image: 'postgres',
        version: '16.15-bookworm',
        digest: `sha256:${'c'.repeat(64)}`,
        licence: 'PostgreSQL',
        files: ['infra/compose/compose.stack.yaml', 'infra/docker/postgres-dev.Dockerfile'],
      },
    ]);
    expect(inventory.problems).toEqual([]);
  });

  it('fails a shipped package under a denied licence, naming it', () => {
    const components = [
      ...cleanComponents,
      { ...npm('mongo-thing', '3.0.0'), licenses: [{ license: { id: 'SSPL-1.0' } }] },
    ];
    const inventory = buildInventory(
      input({
        sboms: [{ image: 'api', bom: sbom(components) }],
        summary: {
          dependencies: 4,
          production: 3,
          packages: ['@scope/tool@1.2.0', 'argparse@2.0.1', 'kysely@0.28.0', 'mongo-thing@3.0.0'],
        },
      }),
    );

    expect(inventory.problems).toEqual([
      'mongo-thing@3.0.0 is under a denied licence (SSPL-1.0); it ships in api. Replace it or, where ADR 0002 allows, record an exception in licence-policy.json.',
    ]);
    expect(inventory.packages.find((pkg) => pkg.name === 'mongo-thing')?.policy).toBe('fails');
  });

  it('fails a package with no licence, and one given only as a URL', () => {
    const components = [
      ...cleanComponents,
      npm('bare', '1.0.0'),
      {
        ...npm('linked', '2.0.0'),
        licenses: [{ license: { url: 'https://example.org/licence' } }],
      },
    ];
    const inventory = buildInventory(
      input({
        sboms: [{ image: 'api', bom: sbom(components) }],
        summary: {
          dependencies: 5,
          production: 4,
          packages: [
            '@scope/tool@1.2.0',
            'argparse@2.0.1',
            'bare@1.0.0',
            'kysely@0.28.0',
            'linked@2.0.0',
          ],
        },
      }),
    );

    expect(inventory.problems).toEqual([
      'bare@1.0.0 ships in api with no licence in its SBOM entry; check it declares an SPDX licence, or replace it.',
      'linked@2.0.0 has no valid SPDX licence ("https://example.org/licence"); it ships in api. Replace it or, where ADR 0002 allows, record an exception in licence-policy.json.',
    ]);
  });

  it('fails a development-only exception that ships', () => {
    const components = [
      ...cleanComponents,
      { ...npm('argparse', '2.0.1'), licenses: [{ license: { id: 'Python-2.0' } }] },
    ];
    const inventory = buildInventory(input({ sboms: [{ image: 'api', bom: sbom(components) }] }));

    expect(inventory.problems).toEqual([
      'argparse@2.0.1 has a development-only exception but is a production dependency; it ships in api. Replace it or, where ADR 0002 allows, record an exception in licence-policy.json.',
    ]);
  });

  it('fails when the SBOMs hold a package the licence check did not see', () => {
    const inventory = buildInventory(
      input({
        summary: { dependencies: 2, production: 1, packages: ['argparse@2.0.1', 'kysely@0.28.0'] },
      }),
    );

    expect(inventory.problems).toEqual([
      '@scope/tool@1.2.0 ships in api, but pnpm check:licences did not see it; build the images and the licence summary from the same commit.',
    ]);
  });

  it('fails SBOMs with no npm package or no image digest', () => {
    const inventory = buildInventory(input({ sboms: [{ image: 'api', bom: { components: [] } }] }));

    expect(inventory.problems).toEqual([
      'The api SBOM names no image digest; scan the image by digest.',
      'The SBOMs hold no npm packages; check Syft scanned the release images.',
    ]);
  });

  it('lists exceptions with their next review, and reports one that is due', () => {
    const inventory = buildInventory(input({ today: '2026-12-10' }));

    expect(inventory.exceptions).toEqual([
      { ...exception, nextReview: '2027-01-04', review: 'due', used: true },
    ]);
    expect(inventory.problems).toEqual([]);
  });

  it('fails an exception past its review date, naming the package', () => {
    const inventory = buildInventory(input({ today: '2027-01-05' }));

    expect(inventory.exceptions[0]?.review).toBe('overdue');
    expect(inventory.problems).toEqual([
      'The exception for argparse@2.0.1 was due for review on 2027-01-04; review it and, once re-approved, update its date in licence-policy.json.',
    ]);
  });

  it('reports an exception for a package that is not installed', () => {
    const inventory = buildInventory(
      input({
        summary: {
          dependencies: 2,
          production: 2,
          packages: ['@scope/tool@1.2.0', 'kysely@0.28.0'],
        },
      }),
    );

    expect(inventory.exceptions[0]?.used).toBe(false);
    expect(inventory.problems).toEqual([]);
  });

  it('fails a Compose image with no service entry', () => {
    const inventory = buildInventory(
      input({
        composeFiles: [
          {
            path: 'infra/compose/compose.dev.yaml',
            text: `  mailpit:\n    image: axllent/mailpit:v1.33.0@${DIGEST}\n`,
          },
        ],
      }),
    );

    expect(inventory.problems).toEqual([
      'axllent/mailpit:v1.33.0 (infra/compose/compose.dev.yaml) has no entry in "services" in licence-policy.json; add its name, image and licence.',
    ]);
    expect(inventory.unusedServices).toEqual(['ClamAV', 'PostgreSQL']);
  });

  it('fails a service or tool licence that is not OSI-approved', () => {
    const services = [
      ...policy.services,
      { name: 'Closed', kind: 'tool' as const, licence: 'BUSL-1.1' },
    ];
    const inventory = buildInventory(input({ policy: { ...policy, services } }));

    expect(inventory.problems).toEqual([
      'Closed is under "BUSL-1.1", which is not an OSI-approved licence ADR 0002 accepts for a separate container or tool.',
    ]);
  });

  it('gives the same JSON for the same release', () => {
    const reversed = input();
    reversed.sboms.reverse();
    reversed.composeFiles.reverse();

    expect(stableJson(buildInventory(reversed))).toBe(stableJson(buildInventory(input())));
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n',
    );
  });
});

describe('nextReview', () => {
  it('is three months after the date, at the end of a shorter month', () => {
    expect(nextReview('2026-09-28')).toBe('2026-12-28');
    expect(nextReview('2026-11-30')).toBe('2027-02-28');
  });
});

describe('inventoryMarkdown', () => {
  it('heads the inventory with the tag, commit, digests and time', () => {
    const markdown = inventoryMarkdown(buildInventory(input()), '2026-11-19T10:00:00Z');

    expect(markdown).toContain('# Licence inventory for release v1.2.3');
    expect(markdown).toContain('- Commit: 0123abc');
    expect(markdown).toContain('- Generated: 2026-11-19T10:00:00Z');
    expect(markdown).toContain(`| api | ${DIGEST} |`);
    expect(markdown).toContain(
      '2 npm packages ship in the release images, under 2 licences. 2 pass the licence policy.',
    );
    expect(markdown).toContain('| ClamAV | clamav/clamav | 1.5.4 |');
    expect(markdown).not.toContain('## Problems');
  });
});

describe('licence-policy.json', () => {
  it('has a service entry for every image the Compose files run', () => {
    const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const repoPolicy = JSON.parse(read('licence-policy.json')) as InventoryPolicy;
    const paths = [
      'infra/compose/compose.dev.yaml',
      'infra/compose/compose.stack.yaml',
      'infra/docker/postgres-dev.Dockerfile',
      'infra/proxy/Dockerfile',
    ];
    const inventory = buildInventory(
      input({
        policy: repoPolicy,
        composeFiles: paths.map((path) => ({ path, text: read(path) })),
      }),
    );

    expect(inventory.problems).toEqual([]);
    expect(inventory.unusedServices).toEqual([]);
    expect(inventory.services.map((service) => service.name)).toEqual([
      'ClamAV',
      'Mailpit',
      'nginx',
      'PostgreSQL',
      'SeaweedFS',
    ]);
  });
});
